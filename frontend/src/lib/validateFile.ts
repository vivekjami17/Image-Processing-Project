import type { RejectionReason } from '../api/types';

export const ACCEPTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic'] as const;
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif']);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Value for <input accept>. HEIC MIME support varies by OS, so extensions are listed too. */
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_EXTENSIONS, ...ACCEPTED_MIME_TYPES].join(',');

type SniffedFormat = 'jpeg' | 'png' | 'heic' | null;

/**
 * Pre-upload checks, so obviously wrong files never leave the browser. The server
 * repeats the format check on the bytes it receives; this is for fast feedback,
 * not security.
 */
export async function validateFile(file: File): Promise<RejectionReason[]> {
  const reasons: RejectionReason[] = [];
  const name = file.name.toLowerCase();

  if (file.size === 0) {
    return [{ code: 'EMPTY_FILE', message: 'The file is empty.' }];
  }

  const extensionOk = ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
  // Browsers often report HEIC as "" and some tools use application/octet-stream.
  const mimeOk = !file.type || file.type === 'application/octet-stream' || ACCEPTED_MIME_TYPES.has(file.type);
  const sniffed = await sniffFormat(file);

  if (!extensionOk || !mimeOk || !sniffed) {
    reasons.push({
      code: 'UNSUPPORTED_FORMAT',
      message: sniffed || !extensionOk
        ? 'Only JPEG, PNG and HEIC images are allowed.'
        : "The file's contents aren't a JPEG, PNG or HEIC image.",
    });
  }

  if (file.size > MAX_FILE_BYTES) {
    reasons.push({ code: 'FILE_TOO_LARGE', message: `Files must be ${MAX_FILE_BYTES / 1024 / 1024} MB or smaller.` });
  }

  return reasons;
}

async function sniffFormat(file: File): Promise<SniffedFormat> {
  const b = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brands = new Set<string>();
    for (let i = 8; i + 4 <= Math.min(b.length, 64); i += 4) if (i !== 12) brands.add(ascii(b, i, i + 4));
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].some((brand) => brands.has(brand))) return 'heic';
  }
  return null;
}

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
