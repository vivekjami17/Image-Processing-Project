import type { ImageRow, ProcessingResult } from '../images/imageRepository.js';
import type { ObjectStorage } from '../storage/index.js';
import { blurScore } from './blur.js';
import { decodeToRgb, fromRgb, ImageDecodeError, ImageTooLargeError, type RgbImage } from './decode.js';
import type { FaceDetector } from './faceDetector.js';
import { detectImageFormat } from './fileSignature.js';
import { differenceHash } from './perceptualHash.js';
import { evaluateContent, largestFace, reason, type RejectionReason, type Thresholds } from './rules.js';

export interface ImageProcessorDeps {
  storage: ObjectStorage;
  faceDetector: FaceDetector;
  thresholds: Thresholds;
  maxInputPixels: number;
}

export const storageKeys = {
  original: (id: string) => `originals/${id}`,
  processed: (id: string) => `processed/${id}.jpg`,
  thumbnail: (id: string) => `thumbnails/${id}.webp`,
};

const THUMBNAIL_EDGE = 480;

const emptyResult = (reasons: RejectionReason[]): ProcessingResult => ({
  width: null,
  height: null,
  blurScore: null,
  faceCount: null,
  faceHeightRatio: null,
  phash: null,
  processedKey: null,
  thumbnailKey: null,
  reasons,
});

/**
 * Runs the pixel-level pipeline for one uploaded image: decode (converting HEIC),
 * write a normalised JPEG and a thumbnail, and measure everything the rules need.
 *
 * Throws only for transient problems (e.g. storage unavailable) so the job is retried;
 * a file that can't be decoded is a deterministic rejection, not a failure.
 */
export class ImageProcessor {
  constructor(private readonly deps: ImageProcessorDeps) {}

  async process(image: ImageRow): Promise<ProcessingResult> {
    if (!image.original_key) throw new Error(`Image ${image.id} has no stored original`);
    const input = await this.deps.storage.get(image.original_key);

    const format = detectImageFormat(input);
    if (!format) return emptyResult([reason('UNSUPPORTED_FORMAT', 'File is not a JPEG, PNG or HEIC image.')]);

    let rgb: RgbImage;
    try {
      rgb = await decodeToRgb(input, format, this.deps.maxInputPixels);
    } catch (err) {
      if (err instanceof ImageTooLargeError) return emptyResult([reason('IMAGE_TOO_LARGE', err.message)]);
      if (err instanceof ImageDecodeError) {
        return emptyResult([reason('CORRUPT_IMAGE', 'The file is damaged or could not be read as an image.')]);
      }
      throw err;
    }

    const [blur, phash, faces, keys] = await Promise.all([
      blurScore(rgb),
      differenceHash(rgb),
      this.deps.faceDetector.detect(rgb),
      this.writeDerivatives(image.id, rgb),
    ]);

    return {
      width: rgb.width,
      height: rgb.height,
      blurScore: blur,
      faceCount: faces.length,
      faceHeightRatio: largestFace(faces)?.height ?? null,
      phash,
      ...keys,
      reasons: evaluateContent({ width: rgb.width, height: rgb.height, blurScore: blur, faces }, this.deps.thresholds),
    };
  }

  /**
   * Every decodable upload gets a JPEG rendition (this is where HEIC is converted)
   * and a small WebP thumbnail for the UI. Both are re-encoded from pixels, which
   * also strips EXIF metadata such as GPS location from anything we serve.
   */
  private async writeDerivatives(id: string, rgb: RgbImage) {
    const [processed, thumbnail] = await Promise.all([
      fromRgb(rgb).jpeg({ quality: 90, mozjpeg: true }).toBuffer(),
      fromRgb(rgb)
        .resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    ]);
    const processedKey = storageKeys.processed(id);
    const thumbnailKey = storageKeys.thumbnail(id);
    await Promise.all([
      this.deps.storage.put({ key: processedKey, body: processed, contentType: 'image/jpeg' }),
      this.deps.storage.put({ key: thumbnailKey, body: thumbnail, contentType: 'image/webp' }),
    ]);
    return { processedKey, thumbnailKey };
  }
}
