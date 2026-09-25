import decodeHeic from 'heic-decode';
import sharp, { type ResizeOptions, type Sharp } from 'sharp';
import type { ImageFormat } from './fileSignature.js';

/** Fully decoded, EXIF-oriented, 8-bit sRGB pixels. */
export interface RgbImage {
  data: Buffer;
  width: number;
  height: number;
}

export class ImageDecodeError extends Error {}
export class ImageTooLargeError extends Error {}

/**
 * Decode any supported format into raw RGB once, so every later step
 * (hashing, blur, faces, re-encoding) works from the same pixels.
 */
export async function decodeToRgb(input: Buffer, format: ImageFormat, maxPixels: number): Promise<RgbImage> {
  // Read dimensions from the header before decoding, so a small file claiming
  // enormous dimensions (a decompression bomb) is refused without allocating it.
  const meta = await sharp(input).metadata().catch(() => {
    throw new ImageDecodeError('Unreadable image header');
  });
  if (!meta.width || !meta.height) throw new ImageDecodeError('Image has no dimensions');
  if (meta.width * meta.height > maxPixels) {
    throw new ImageTooLargeError(`Image is ${meta.width}x${meta.height}, above the pixel limit`);
  }

  try {
    const pipeline = format === 'heic' ? await heicPipeline(input) : sharp(input, { limitInputPixels: maxPixels }).rotate();
    const { data, info } = await pipeline
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof ImageDecodeError) throw err;
    throw new ImageDecodeError(`Failed to decode ${format} image: ${(err as Error).message}`);
  }
}

// Prebuilt sharp/libvips ships without an HEVC decoder (patent licensing), so HEIC is
// decoded by libheif compiled to WebAssembly and handed to sharp as raw pixels.
async function heicPipeline(input: Buffer): Promise<Sharp> {
  const { width, height, data } = await decodeHeic({ buffer: input });
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels: 4 },
  });
}

export function fromRgb(image: RgbImage): Sharp {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
}

/** Single-channel grayscale pixels after applying `resize`. */
export async function toGray(
  image: RgbImage,
  resize: ResizeOptions,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await fromRgb(image)
    .resize(resize)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
