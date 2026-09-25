import type { FaceBox } from './faceDetector.js';

export const REJECTION_CODES = [
  'UNSUPPORTED_FORMAT',
  'FILE_TOO_SMALL',
  'RESOLUTION_TOO_LOW',
  'CORRUPT_IMAGE',
  'IMAGE_TOO_LARGE',
  'BLURRY',
  'FACE_TOO_SMALL',
  'MULTIPLE_FACES',
  'TOO_SIMILAR',
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface RejectionReason {
  code: RejectionCode;
  message: string;
}

export interface Thresholds {
  minFileBytes: number;
  minWidth: number;
  minHeight: number;
  blurThreshold: number;
  faceMinHeightRatio: number;
}

export interface ImageMetrics {
  width: number;
  height: number;
  blurScore: number;
  faces: FaceBox[];
}

export const reason = (code: RejectionCode, message: string): RejectionReason => ({ code, message });

/** Checks that only need the raw bytes, so they can run synchronously at upload time. */
export function checkFileSize(sizeBytes: number, t: Pick<Thresholds, 'minFileBytes'>): RejectionReason | null {
  if (sizeBytes >= t.minFileBytes) return null;
  return reason('FILE_TOO_SMALL', `File is ${formatBytes(sizeBytes)}; the minimum is ${formatBytes(t.minFileBytes)}.`);
}

/**
 * Content rules evaluated by the worker on decoded pixels. Every failing rule is
 * reported (not just the first) so the user can fix everything in one go.
 * Similarity is checked separately because it needs the database.
 */
export function evaluateContent(m: ImageMetrics, t: Thresholds): RejectionReason[] {
  const reasons: RejectionReason[] = [];

  if (m.width < t.minWidth || m.height < t.minHeight) {
    reasons.push(
      reason(
        'RESOLUTION_TOO_LOW',
        `Resolution is ${m.width}×${m.height}px; the minimum is ${t.minWidth}×${t.minHeight}px.`,
      ),
    );
  }

  if (m.blurScore < t.blurThreshold) {
    reasons.push(
      reason('BLURRY', `Image is too blurry (sharpness ${m.blurScore.toFixed(0)}, minimum ${t.blurThreshold}).`),
    );
  }

  if (m.faces.length > 1) {
    reasons.push(reason('MULTIPLE_FACES', `${m.faces.length} faces detected; only one is allowed.`));
  }

  const largest = largestFace(m.faces);
  if (largest && largest.height < t.faceMinHeightRatio) {
    reasons.push(
      reason(
        'FACE_TOO_SMALL',
        `Face fills ${pct(largest.height)} of the image height; it must fill at least ${pct(t.faceMinHeightRatio)}.`,
      ),
    );
  }

  return reasons;
}

export function largestFace(faces: FaceBox[]): FaceBox | undefined {
  return faces.reduce<FaceBox | undefined>((best, f) => (!best || f.height > best.height ? f : best), undefined);
}

const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
