import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger.js';
import { detectImageFormat, MIME_TYPES } from '../processing/fileSignature.js';
import { storageKeys } from '../processing/imageProcessor.js';
import { checkFileSize, reason, type Thresholds } from '../processing/rules.js';
import type { ObjectStorage } from '../storage/index.js';
import type { ImageRepository, ImageRow, NewImage } from './imageRepository.js';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export class ImageService {
  constructor(
    private readonly repo: ImageRepository,
    private readonly storage: ObjectStorage,
    private readonly thresholds: Pick<Thresholds, 'minFileBytes'>,
    private readonly logger: Logger,
  ) {}

  /**
   * Accept a batch of uploads. Anything decidable from the bytes alone (format, file
   * size) is rejected immediately and never stored. Everything else is written to
   * object storage and queued as `pending` for the worker; the caller gets 202 and
   * follows progress via the events stream.
   */
  async upload(files: UploadedFile[]): Promise<ImageRow[]> {
    const records = await Promise.all(files.map((file) => this.prepare(file)));
    try {
      return await this.repo.insertMany(records);
    } catch (err) {
      // Don't orphan objects whose rows never made it into the database.
      const keys = records.flatMap((r) => (r.original_key ? [r.original_key] : []));
      await this.storage.delete(keys).catch((cleanupErr: unknown) =>
        this.logger.error({ err: cleanupErr, keys }, 'failed to clean up orphaned uploads'),
      );
      throw err;
    }
  }

  private async prepare(file: UploadedFile): Promise<NewImage> {
    const id = randomUUID();
    const base = { id, original_filename: sanitizeFilename(file.originalname), size_bytes: file.size };

    const format = detectImageFormat(file.buffer);
    if (!format) {
      return {
        ...base,
        status: 'rejected',
        processed_at: new Date(),
        rejection_reasons: [reason('UNSUPPORTED_FORMAT', 'Only JPEG, PNG and HEIC images are accepted.')],
      };
    }

    const tooSmall = checkFileSize(file.size, this.thresholds);
    if (tooSmall) {
      return { ...base, format, mime_type: MIME_TYPES[format], status: 'rejected', processed_at: new Date(), rejection_reasons: [tooSmall] };
    }

    const key = storageKeys.original(id);
    await this.storage.put({ key, body: file.buffer, contentType: MIME_TYPES[format] });
    return { ...base, format, mime_type: MIME_TYPES[format], status: 'pending', original_key: key };
  }

  async delete(id: string): Promise<boolean> {
    const row = await this.repo.delete(id);
    if (!row) return false;
    const keys = [row.original_key, row.processed_key, row.thumbnail_key].filter((k): k is string => !!k);
    // The row is the source of truth; a storage hiccup here leaves an unreferenced
    // object (cleanable by a lifecycle rule) rather than failing the user's request.
    await this.storage.delete(keys).catch((err: unknown) => this.logger.error({ err, keys }, 'failed to delete objects'));
    return true;
  }
}

/** Keep the user's filename for display only; it never reaches a path or storage key. */
export function sanitizeFilename(name: string): string {
  const base = name.normalize('NFC').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'untitled').slice(0, 255);
}
