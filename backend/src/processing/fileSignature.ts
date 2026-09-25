export type ImageFormat = 'jpeg' | 'png' | 'heic';

export const MIME_TYPES: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// HEVC-coded HEIF brands. Plain "mif1" is also used by AVIF, so on its own it isn't enough.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);

/**
 * Identify the image format from the file's leading bytes. The client-provided
 * filename and Content-Type are never trusted for this decision.
 */
export function detectImageFormat(buf: Uint8Array): ImageFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && PNG_SIGNATURE.every((b, i) => buf[i] === b)) return 'png';
  if (isHeic(buf)) return 'heic';
  return null;
}

function isHeic(buf: Uint8Array): boolean {
  // ISO-BMFF: [u32 box size]["ftyp"][major brand][u32 minor version][compatible brands...]
  if (buf.length < 16 || ascii(buf, 4, 8) !== 'ftyp') return false;
  const boxSize = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  const end = Math.min(boxSize, buf.length);
  if (HEIC_BRANDS.has(ascii(buf, 8, 12))) return true;
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (HEIC_BRANDS.has(ascii(buf, offset, offset + 4))) return true;
  }
  return false;
}

function ascii(buf: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...buf.subarray(start, end));
}
