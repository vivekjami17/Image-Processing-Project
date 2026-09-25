import { createRequire } from 'node:module';
import path from 'node:path';
import { fromRgb, type RgbImage } from './decode.js';

/** Face bounding box in coordinates relative to the image (0..1). */
export interface FaceBox {
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceDetector {
  detect(image: RgbImage): Promise<FaceBox[]>;
}

// The detector's own input is 512px; feeding it more only costs time.
const DETECTION_EDGE = 640;

// Fraction of the full width/height each quadrant covers. Four quadrants at 60%,
// anchored to the corners, overlap by 20% along each axis so a face straddling
// the middle of the frame still falls comfortably inside at least one of them.
const QUADRANT_FRACTION = 0.6;
const QUADRANT_ORIGINS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 }, // top-left
  { x: 1 - QUADRANT_FRACTION, y: 0 }, // top-right
  { x: 0, y: 1 - QUADRANT_FRACTION }, // bottom-left
  { x: 1 - QUADRANT_FRACTION, y: 1 - QUADRANT_FRACTION }, // bottom-right
];

// Greedy non-max suppression merge threshold for the quadrant fallback pass.
const NMS_IOU_THRESHOLD = 0.3;

interface PixelRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

type FaceApi = typeof import('@vladmandic/face-api/dist/face-api.node-wasm.js');

/**
 * SSD-MobileNetV1 face detector (face-api.js) running on TensorFlow.js's WebAssembly
 * backend: no native TensorFlow binary to install, and the model weights ship inside
 * the npm package, so the worker has no runtime download.
 *
 * A face very close to the edge of what our size rule allows (roughly under ~10% of
 * the image height) is often missed entirely at full-frame scale, because the whole
 * image is downscaled to fit the detector's fixed input size and the face shrinks
 * along with it. When the full frame comes back empty, we run a second pass over
 * four overlapping quadrants instead: each quadrant is a smaller crop of the original
 * pixels, so it downscales less on the way to the same detector input size and a
 * small face effectively appears larger to the model. Detections are mapped back to
 * full-image coordinates and merged with non-max suppression, since an overlapping
 * region can pick up the same face twice.
 */
export class SsdFaceDetector implements FaceDetector {
  private ready: Promise<FaceApi> | undefined;

  constructor(private readonly minConfidence: number) {}

  private load(): Promise<FaceApi> {
    this.ready ??= (async () => {
      const require = createRequire(import.meta.url);
      const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as FaceApi;
      // face-api's node-wasm build resolves these same module instances internally.
      const tf = require('@tensorflow/tfjs') as typeof import('@tensorflow/tfjs');
      const wasm = require('@tensorflow/tfjs-backend-wasm') as typeof import('@tensorflow/tfjs-backend-wasm');
      const wasmDir = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm'));
      wasm.setWasmPaths(wasmDir + path.sep);
      await tf.setBackend('wasm');
      await tf.ready();
      const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
      return faceapi;
    })();
    return this.ready;
  }

  /** Load the model eagerly so the first job doesn't pay for it. */
  async warmUp(): Promise<void> {
    await this.load();
  }

  async detect(image: RgbImage): Promise<FaceBox[]> {
    const fullFrame = await this.detectRegion(image);
    if (fullFrame.length > 0) return fullFrame;

    const quadrants = QUADRANT_ORIGINS.map((origin) => toPixelRegion(origin, image.width, image.height));
    const found: FaceBox[] = [];
    for (const region of quadrants) {
      const boxes = await this.detectRegion(image, region);
      for (const box of boxes) found.push(mapToFullImage(box, region, image.width, image.height));
    }
    return suppressOverlapping(found, NMS_IOU_THRESHOLD);
  }

  /** Runs detection on the full image, or a pixel-space crop of it if `region` is given. */
  private async detectRegion(image: RgbImage, region?: PixelRegion): Promise<FaceBox[]> {
    const faceapi = await this.load();
    let pipeline = fromRgb(image);
    if (region) pipeline = pipeline.extract(region);
    const { data, info } = await pipeline
      .resize({ width: DETECTION_EDGE, height: DETECTION_EDGE, fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tensor = faceapi.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
    try {
      const detections = await faceapi.detectAllFaces(
        tensor as unknown as Parameters<FaceApi['detectAllFaces']>[0],
        new faceapi.SsdMobilenetv1Options({ minConfidence: this.minConfidence }),
      );
      return detections.map(({ score, box }) => ({
        score,
        x: box.x / info.width,
        y: box.y / info.height,
        width: box.width / info.width,
        height: box.height / info.height,
      }));
    } finally {
      tensor.dispose();
    }
  }
}

/** Turns a quadrant's fractional origin into a pixel-space crop, clamped to the image. */
function toPixelRegion(origin: { x: number; y: number }, imageWidth: number, imageHeight: number): PixelRegion {
  const left = Math.round(origin.x * imageWidth);
  const top = Math.round(origin.y * imageHeight);
  return {
    left,
    top,
    width: Math.min(imageWidth - left, Math.round(QUADRANT_FRACTION * imageWidth)),
    height: Math.min(imageHeight - top, Math.round(QUADRANT_FRACTION * imageHeight)),
  };
}

/** Maps a box in region-relative (0..1) coordinates back to full-image (0..1) coordinates. */
function mapToFullImage(box: FaceBox, region: PixelRegion, imageWidth: number, imageHeight: number): FaceBox {
  return {
    score: box.score,
    x: (region.left + box.x * region.width) / imageWidth,
    y: (region.top + box.y * region.height) / imageHeight,
    width: (box.width * region.width) / imageWidth,
    height: (box.height * region.height) / imageHeight,
  };
}

/**
 * Greedy non-max suppression: keeps the highest-scoring box, drops every remaining
 * box that overlaps it by more than `iouThreshold`, and repeats with what's left.
 * Exported for unit testing.
 */
export function suppressOverlapping(boxes: FaceBox[], iouThreshold: number): FaceBox[] {
  const kept: FaceBox[] = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    if (kept.some((k) => iou(k, box) > iouThreshold)) continue;
    kept.push(box);
  }
  return kept;
}

function iou(a: FaceBox, b: FaceBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  if (intersection === 0) return 0;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}
