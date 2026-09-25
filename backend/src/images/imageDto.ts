import type { RejectionReason } from '../processing/rules.js';
import type { ImageRow, ImageStatus } from './imageRepository.js';

export interface ImageDto {
  id: string;
  originalFilename: string;
  format: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejectionReasons: RejectionReason[];
  metrics: {
    blurScore: number | null;
    faceCount: number | null;
    faceHeightRatio: number | null;
  };
  similarToId: string | null;
  urls: {
    thumbnail: string | null;
    processed: string | null;
    original: string | null;
  };
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

export function toImageDto(row: ImageRow): ImageDto {
  const url = (key: string | null, variant: string) => (key ? `/api/images/${row.id}/${variant}` : null);
  return {
    id: row.id,
    originalFilename: row.original_filename,
    format: row.format,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    status: row.status,
    rejectionReasons: row.rejection_reasons,
    metrics: {
      blurScore: row.blur_score,
      faceCount: row.face_count,
      faceHeightRatio: row.face_height_ratio,
    },
    similarToId: row.similar_to_id,
    urls: {
      thumbnail: url(row.thumbnail_key, 'thumbnail'),
      processed: url(row.processed_key, 'processed'),
      original: url(row.original_key, 'original'),
    },
    // Internal error text stays server-side; the client only needs to know it failed.
    error: row.status === 'failed' ? 'Processing failed. Please try uploading again.' : null,
    createdAt: row.created_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
  };
}
