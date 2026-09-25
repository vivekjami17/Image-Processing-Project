import type { Knex } from 'knex';
import type { ImageFormat } from '../processing/fileSignature.js';
import type { RejectionReason } from '../processing/rules.js';

export const IMAGE_STATUSES = ['pending', 'processing', 'accepted', 'rejected', 'failed'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

export interface ImageRow {
  id: string;
  original_filename: string;
  format: ImageFormat | null;
  mime_type: string | null;
  size_bytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejection_reasons: RejectionReason[];
  blur_score: number | null;
  face_count: number | null;
  face_height_ratio: number | null;
  phash: string | null;
  similar_to_id: string | null;
  original_key: string | null;
  processed_key: string | null;
  thumbnail_key: string | null;
  attempts: number;
  run_after: Date;
  locked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  processed_at: Date | null;
}

export type NewImage = Pick<ImageRow, 'id' | 'original_filename' | 'size_bytes' | 'status'> &
  Partial<Pick<ImageRow, 'format' | 'mime_type' | 'original_key' | 'rejection_reasons' | 'processed_at'>>;

export interface ProcessingResult {
  width: number | null;
  height: number | null;
  blurScore: number | null;
  faceCount: number | null;
  faceHeightRatio: number | null;
  phash: bigint | null;
  processedKey: string | null;
  thumbnailKey: string | null;
  reasons: RejectionReason[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Postgres NOTIFY channels. */
export const CHANNELS = {
  /** Wakes idle workers when new work is queued. */
  jobs: 'image_jobs',
  /** Status changes, relayed to browsers over Server-Sent Events. */
  events: 'image_events',
} as const;

export type ImageEvent = { type: 'updated'; id: string } | { type: 'deleted'; id: string };

// Arbitrary constant namespacing the advisory lock that serialises final decisions,
// so two near-identical uploads processed concurrently can't both be accepted.
const DECISION_LOCK_KEY = 0x1a6e_5e;

const TABLE = 'images';

export class ImageRepository {
  constructor(private readonly db: Knex) {}

  async insertMany(images: NewImage[]): Promise<ImageRow[]> {
    if (images.length === 0) return [];
    return this.db.transaction(async (trx) => {
      const rows: ImageRow[] = await trx(TABLE)
        .insert(images.map((i) => ({ ...i, rejection_reasons: JSON.stringify(i.rejection_reasons ?? []) })))
        .returning('*');
      if (rows.some((r) => r.status === 'pending')) await notify(trx, CHANNELS.jobs, '');
      return rows;
    });
  }

  async findById(id: string): Promise<ImageRow | undefined> {
    return this.db<ImageRow>(TABLE).where({ id }).first();
  }

  /**
   * Keyset pagination on (created_at, id). Unlike OFFSET, cost stays constant however
   * deep the client pages, and it's served straight from the (status, created_at, id) index.
   */
  async list(opts: { status?: ImageStatus[] | undefined; limit: number; cursor?: string | undefined }): Promise<Page<ImageRow>> {
    const query = this.db<ImageRow>(TABLE)
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(opts.limit + 1);

    if (opts.status?.length) query.whereIn('status', opts.status);
    if (opts.cursor) {
      const { createdAt, id } = decodeCursor(opts.cursor);
      query.whereRaw('(created_at, id) < (?::timestamptz, ?::uuid)', [createdAt, id]);
    }

    const rows = await query;
    const items = rows.slice(0, opts.limit);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > opts.limit && last ? encodeCursor(last) : null };
  }

  async countByStatus(): Promise<Record<ImageStatus, number>> {
    const rows = await this.db(TABLE).select('status').count<{ status: ImageStatus; count: string }[]>('* as count').groupBy('status');
    const counts = Object.fromEntries(IMAGE_STATUSES.map((s) => [s, 0])) as Record<ImageStatus, number>;
    for (const r of rows) counts[r.status] = Number(r.count);
    return counts;
  }

  /** Deletes the row and returns it, so the caller can remove its stored objects. */
  async delete(id: string): Promise<ImageRow | undefined> {
    return this.db.transaction(async (trx) => {
      const [row] = await trx<ImageRow>(TABLE).where({ id }).delete().returning('*');
      if (row) await notifyEvent(trx, { type: 'deleted', id });
      return row;
    });
  }

  // ---------------------------------------------------------------------------
  // Work queue. The images table itself is the queue: `pending` rows are jobs.
  // ---------------------------------------------------------------------------

  /**
   * Atomically claim up to `limit` due jobs. SKIP LOCKED lets any number of worker
   * processes poll concurrently without handing the same image to two of them.
   */
  async claimJobs(limit: number): Promise<ImageRow[]> {
    return this.db.transaction(async (trx) => {
      const { rows } = await trx.raw<{ rows: ImageRow[] }>(
        `
        UPDATE images SET status = 'processing', attempts = attempts + 1, locked_at = now(), updated_at = now()
        WHERE id IN (
          SELECT id FROM images
          WHERE status = 'pending' AND run_after <= now()
          ORDER BY run_after, created_at
          LIMIT ?
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        `,
        [limit],
      );
      // Let the UI show "analyzing" rather than "queued".
      for (const row of rows) await notifyEvent(trx, { type: 'updated', id: row.id });
      return rows;
    });
  }

  /** Return jobs whose worker died mid-flight to the queue. */
  async requeueStale(staleAfterSeconds: number): Promise<number> {
    const count = await this.db<ImageRow>(TABLE)
      .where('status', 'processing')
      .andWhere('locked_at', '<', this.db.raw(`now() - make_interval(secs => ?)`, [staleAfterSeconds]))
      .update({ status: 'pending', locked_at: null, updated_at: this.db.fn.now() });
    if (count > 0) await notify(this.db, CHANNELS.jobs, '');
    return count;
  }

  /**
   * Record the outcome of processing. Similarity against already-accepted images is
   * decided here, under a transaction-scoped advisory lock, so the check and the
   * status change are atomic with respect to other workers.
   *
   * Returns the updated row, or undefined if the image was deleted while processing.
   */
  async complete(id: string, result: ProcessingResult, similarityMaxDistance: number): Promise<ImageRow | undefined> {
    return this.db.transaction(async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [DECISION_LOCK_KEY]);

      const reasons = [...result.reasons];
      let similarToId: string | null = null;
      if (result.phash !== null) {
        const match = await this.findMostSimilarAccepted(trx, id, result.phash, similarityMaxDistance);
        if (match) {
          similarToId = match.id;
          reasons.push({
            code: 'TOO_SIMILAR',
            message: `Too similar to an image that was already accepted (difference ${match.distance}/64).`,
          });
        }
      }

      const [row]: ImageRow[] = await trx(TABLE)
        .where({ id, status: 'processing' })
        .update({
          status: reasons.length ? 'rejected' : 'accepted',
          rejection_reasons: JSON.stringify(reasons),
          width: result.width,
          height: result.height,
          blur_score: result.blurScore,
          face_count: result.faceCount,
          face_height_ratio: result.faceHeightRatio,
          phash: result.phash === null ? null : result.phash.toString(),
          similar_to_id: similarToId,
          processed_key: result.processedKey,
          thumbnail_key: result.thumbnailKey,
          locked_at: null,
          last_error: null,
          processed_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        })
        .returning('*');

      if (row) await notifyEvent(trx, { type: 'updated', id });
      return row;
    });
  }

  /**
   * Nearest accepted image by Hamming distance between 64-bit hashes. This is an
   * index-only scan over images_phash_accepted_idx: linear, but over a narrow index
   * of 8-byte keys. See README for how this would move to multi-index hashing at scale.
   */
  private async findMostSimilarAccepted(
    trx: Knex.Transaction,
    id: string,
    phash: bigint,
    maxDistance: number,
  ): Promise<{ id: string; distance: number } | undefined> {
    const { rows } = await trx.raw<{ rows: { id: string; distance: number }[] }>(
      `
      SELECT id, bit_count((phash # ?::bigint)::bit(64))::int AS distance
      FROM images
      WHERE status = 'accepted' AND phash IS NOT NULL AND id <> ?
        AND bit_count((phash # ?::bigint)::bit(64)) <= ?
      ORDER BY distance
      LIMIT 1
      `,
      [phash.toString(), id, phash.toString(), maxDistance],
    );
    return rows[0];
  }

  /** Retry with exponential backoff, or give up and mark the image failed. */
  async fail(id: string, error: string, maxAttempts: number): Promise<ImageRow | undefined> {
    return this.db.transaction(async (trx) => {
      const [row]: ImageRow[] = await trx(TABLE)
        .where({ id, status: 'processing' })
        .update({
          status: trx.raw(`CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END::image_status`, [maxAttempts]),
          run_after: trx.raw('now() + make_interval(secs => power(4, attempts))'),
          last_error: error.slice(0, 2000),
          locked_at: null,
          updated_at: trx.fn.now(),
        })
        .returning('*');
      if (row) await notifyEvent(trx, { type: 'updated', id });
      return row;
    });
  }
}

async function notify(db: Knex | Knex.Transaction, channel: string, payload: string): Promise<void> {
  await db.raw('SELECT pg_notify(?, ?)', [channel, payload]);
}

// NOTIFY inside a transaction is only delivered on commit, so listeners never see
// an event for a change that was rolled back.
function notifyEvent(trx: Knex.Transaction, event: ImageEvent): Promise<void> {
  return notify(trx, CHANNELS.events, JSON.stringify(event));
}

function encodeCursor(row: Pick<ImageRow, 'created_at' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.created_at.toISOString(), row.id])).toString('base64url');
}

export class InvalidCursorError extends Error {}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown[];
    if (typeof createdAt === 'string' && typeof id === 'string' && UUID_RE.test(id) && !Number.isNaN(Date.parse(createdAt))) {
      return { createdAt, id };
    }
  } catch {
    // fall through
  }
  throw new InvalidCursorError('Invalid pagination cursor');
}
