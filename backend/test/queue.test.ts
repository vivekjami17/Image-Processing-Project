import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { ImageRepository, type ProcessingResult } from '../src/images/imageRepository.js';
import { describeWithDb, resetDb, setupDb } from './helpers.js';

const result = (overrides: Partial<ProcessingResult> = {}): ProcessingResult => ({
  width: 800,
  height: 800,
  blurScore: 200,
  faceCount: 1,
  faceHeightRatio: 0.4,
  phash: 0x0f0f_0f0f_0f0f_0f0fn,
  processedKey: null,
  thumbnailKey: null,
  reasons: [],
  ...overrides,
});

describeWithDb('postgres job queue', () => {
  let db: Knex;
  let repo: ImageRepository;

  beforeAll(async () => {
    db = await setupDb();
    repo = new ImageRepository(db);
  });
  afterAll(() => db.destroy());
  beforeEach(() => resetDb(db));

  const enqueue = (n: number) =>
    repo.insertMany(
      Array.from({ length: n }, (_, i) => ({
        id: randomUUID(),
        original_filename: `${i}.jpg`,
        size_bytes: 1000,
        status: 'pending' as const,
        original_key: `originals/${i}`,
      })),
    );

  it('never hands the same job to two concurrent claimers', async () => {
    await enqueue(20);
    const batches = await Promise.all(Array.from({ length: 5 }, () => repo.claimJobs(6)));
    const ids = batches.flat().map((r) => r.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(batches.flat().every((r) => r.status === 'processing' && r.attempts === 1)).toBe(true);
  });

  it('retries with backoff, then marks the job failed', async () => {
    const [img] = await enqueue(1);
    await repo.claimJobs(1);
    const retry = await repo.fail(img!.id, 'boom', 2);
    expect(retry).toMatchObject({ status: 'pending', last_error: 'boom' });
    expect(retry!.run_after.getTime()).toBeGreaterThan(Date.now());

    expect(await repo.claimJobs(1)).toHaveLength(0); // not due yet
    await db('images').update({ run_after: db.fn.now() });
    await repo.claimJobs(1);
    expect(await repo.fail(img!.id, 'boom again', 2)).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('requeues jobs abandoned by a crashed worker', async () => {
    await enqueue(1);
    await repo.claimJobs(1);
    expect(await repo.requeueStale(60)).toBe(0);
    await db('images').update({ locked_at: db.raw("now() - interval '2 minutes'") });
    expect(await repo.requeueStale(60)).toBe(1);
    expect(await repo.claimJobs(1)).toHaveLength(1);
  });

  it('rejects a near-duplicate of an accepted image', async () => {
    const [a, b, c] = await enqueue(3);
    await repo.claimJobs(3);
    expect(await repo.complete(a!.id, result(), 8)).toMatchObject({ status: 'accepted' });

    // 3 bits different: too similar
    const dup = await repo.complete(b!.id, result({ phash: 0x0f0f_0f0f_0f0f_0f08n }), 8);
    expect(dup).toMatchObject({ status: 'rejected', similar_to_id: a!.id });
    expect(dup!.rejection_reasons.map((r) => r.code)).toEqual(['TOO_SIMILAR']);

    // Inverted hash (64 bits different), including the sign bit: distinct
    expect(await repo.complete(c!.id, result({ phash: ~0x0f0f_0f0f_0f0f_0f0fn }), 8)).toMatchObject({ status: 'accepted' });
  });

  it('only one of two identical images processed concurrently is accepted', async () => {
    const images = await enqueue(6);
    await repo.claimJobs(6);
    const rows = await Promise.all(images.map((img) => repo.complete(img.id, result(), 8)));
    expect(rows.filter((r) => r!.status === 'accepted')).toHaveLength(1);
  });

  it('does not resurrect an image deleted mid-processing', async () => {
    const [img] = await enqueue(1);
    await repo.claimJobs(1);
    await repo.delete(img!.id);
    expect(await repo.complete(img!.id, result(), 8)).toBeUndefined();
  });

  it('serves the similarity lookup from the partial phash index', async () => {
    await db.raw('SET enable_seqscan = off');
    const { rows } = await db.raw(`
      EXPLAIN SELECT id FROM images
      WHERE status = 'accepted' AND phash IS NOT NULL
        AND bit_count((phash # 1::bigint)::bit(64)) <= 8`);
    await db.raw('SET enable_seqscan = on');
    const plan = rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
    expect(plan).toContain('images_phash_accepted_idx');
  });
});
