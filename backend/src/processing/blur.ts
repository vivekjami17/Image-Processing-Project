import { type RgbImage, toGray } from './decode.js';

// Sharpness depends on scale (downsampling hides blur), so every image is measured
// at the same working size to keep one threshold meaningful across resolutions.
const ANALYSIS_EDGE = 512;
const GRID = 4;

/**
 * Sharpness of the image's sharpest region: the variance of the Laplacian is computed
 * per tile of a 4x4 grid and the maximum is returned. Scoring the whole frame would
 * penalise portraits with a deliberately soft background (bokeh) even when the
 * subject is crisp; an image is only "blurry" if nothing in it is sharp.
 * Higher = sharper.
 */
export async function blurScore(image: RgbImage): Promise<number> {
  const gray = await toGray(image, {
    width: ANALYSIS_EDGE,
    height: ANALYSIS_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
  });
  return sharpestTileVariance(gray.data, gray.width, gray.height, GRID);
}

export function sharpestTileVariance(px: Uint8Array, width: number, height: number, grid: number): number {
  const tileW = Math.floor(width / grid);
  const tileH = Math.floor(height / grid);
  if (tileW < 3 || tileH < 3) return laplacianVariance(px, width, height, { x: 0, y: 0, w: width, h: height });

  let best = 0;
  for (let ty = 0; ty < grid; ty++) {
    for (let tx = 0; tx < grid; tx++) {
      const v = laplacianVariance(px, width, height, { x: tx * tileW, y: ty * tileH, w: tileW, h: tileH });
      if (v > best) best = v;
    }
  }
  return best;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Variance of the 4-neighbour Laplacian [0 1 0; 1 -4 1; 0 1 0] over a region. */
export function laplacianVariance(px: Uint8Array, width: number, height: number, r: Region): number {
  // Skip the outermost image row/column, where the kernel would read out of bounds.
  const x0 = Math.max(r.x, 1);
  const y0 = Math.max(r.y, 1);
  const x1 = Math.min(r.x + r.w, width - 1);
  const y1 = Math.min(r.y + r.h, height - 1);

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const i = row + x;
      const v = px[i - width]! + px[i + width]! + px[i - 1]! + px[i + 1]! - 4 * px[i]!;
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
