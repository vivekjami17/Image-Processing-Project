import type { Config } from '../config.js';
import type { Thresholds } from './rules.js';

export function thresholdsFrom(config: Config): Thresholds {
  return {
    minFileBytes: config.MIN_FILE_BYTES,
    minWidth: config.MIN_WIDTH,
    minHeight: config.MIN_HEIGHT,
    blurThreshold: config.BLUR_THRESHOLD,
    faceMinHeightRatio: config.FACE_MIN_HEIGHT_RATIO,
  };
}
