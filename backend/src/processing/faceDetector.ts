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

type FaceApi = typeof import('@vladmandic/face-api/dist/face-api.node-wasm.js');

/**
 * SSD-MobileNetV1 face detector (face-api.js) running on TensorFlow.js's WebAssembly
 * backend: no native TensorFlow binary to install, and the model weights ship inside
 * the npm package, so the worker has no runtime download.
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
    const faceapi = await this.load();
    const { data, info } = await fromRgb(image)
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
