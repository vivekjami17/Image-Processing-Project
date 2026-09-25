import sharp from 'sharp';
import { blurScore, laplacianVariance } from '../src/processing/blur.js';
import { decodeToRgb, ImageDecodeError, ImageTooLargeError } from '../src/processing/decode.js';
import { differenceHash, hammingDistance } from '../src/processing/perceptualHash.js';
import { fixture } from './helpers.js';

const rgbOf = async (input: Buffer) => decodeToRgb(input, 'jpeg', 60_000_000);

describe('blur score', () => {
  it('is zero for a flat image and high for a checkerboard', () => {
    const flat = new Uint8Array(100).fill(128);
    expect(laplacianVariance(flat, 10, 10, { x: 0, y: 0, w: 10, h: 10 })).toBe(0);
    const checker = Uint8Array.from({ length: 100 }, (_, i) => ((i % 10) + Math.floor(i / 10)) % 2 ? 255 : 0);
    expect(laplacianVariance(checker, 10, 10, { x: 0, y: 0, w: 10, h: 10 })).toBeGreaterThan(10_000);
  });

  it('separates a sharp portrait from a blurred copy of it', async () => {
    const photo = await fixture('single-face.jpg');
    const sharpScore = await blurScore(await rgbOf(photo));
    const blurredScore = await blurScore(await rgbOf(await sharp(photo).blur(3).toBuffer()));
    expect(sharpScore).toBeGreaterThan(50);
    expect(blurredScore).toBeLessThan(50);
  });
});

describe('perceptual hash', () => {
  it('is stable across re-encoding and resizing', async () => {
    const photo = await fixture('single-face.jpg');
    const original = await differenceHash(await rgbOf(photo));
    const recompressed = await differenceHash(await rgbOf(await sharp(photo).jpeg({ quality: 30 }).toBuffer()));
    const resized = await differenceHash(await rgbOf(await sharp(photo).resize(250).toBuffer()));
    expect(hammingDistance(original, recompressed)).toBeLessThanOrEqual(2);
    expect(hammingDistance(original, resized)).toBeLessThanOrEqual(2);
  });

  it('is far apart for different photos', async () => {
    const a = await differenceHash(await rgbOf(await fixture('single-face.jpg')));
    const b = await differenceHash(await rgbOf(await fixture('group.jpg')));
    expect(hammingDistance(a, b)).toBeGreaterThan(16);
  });

  it('fits in a signed 64-bit integer', async () => {
    const h = await differenceHash(await rgbOf(await fixture('group.jpg')));
    expect(h).toBe(BigInt.asIntN(64, h));
  });

  it('counts bits correctly including the sign bit', () => {
    expect(hammingDistance(0n, -1n)).toBe(64);
    expect(hammingDistance(0b1011n, 0b0001n)).toBe(2);
  });
});

describe('decoding', () => {
  it('decodes HEIC to RGB', async () => {
    const rgb = await decodeToRgb(await fixture('landscape.heic'), 'heic', 60_000_000);
    expect([rgb.width, rgb.height]).toEqual([1280, 854]);
    expect(rgb.data.length).toBe(1280 * 854 * 3);
  });

  it('refuses images above the pixel limit before decoding', async () => {
    await expect(decodeToRgb(await fixture('group.jpg'), 'jpeg', 1000)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it('reports corrupt data as a decode error', async () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000, 7)]);
    await expect(decodeToRgb(corrupt, 'jpeg', 60_000_000)).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('applies EXIF orientation', async () => {
    const rotated = await sharp(await fixture('single-face.jpg')).resize(600, 300, { fit: 'fill' }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const rgb = await rgbOf(rotated);
    expect([rgb.width, rgb.height]).toEqual([300, 600]);
  });
});
