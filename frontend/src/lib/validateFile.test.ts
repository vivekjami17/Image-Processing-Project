import { validateFile } from './validateFile';

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC = [0, 0, 0, 24, ...'ftypheic'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c));

function file(bytes: number[], name: string, type = '', size = 1000): File {
  const data = new Uint8Array(Math.max(size, bytes.length));
  data.set(bytes);
  return new File([data], name, { type });
}

const codes = async (f: File) => (await validateFile(f)).map((r) => r.code);

describe('validateFile', () => {
  it.each([
    ['photo.jpg', JPEG, 'image/jpeg'],
    ['photo.JPEG', JPEG, 'image/jpeg'],
    ['shot.png', PNG, 'image/png'],
    ['IMG_0001.HEIC', HEIC, ''],
    ['IMG_0002.heic', HEIC, 'image/heic'],
  ])('accepts %s', async (name, bytes, type) => {
    expect(await codes(file(bytes, name, type))).toEqual([]);
  });

  it('rejects other extensions even with image content', async () => {
    expect(await codes(file(JPEG, 'photo.gif', 'image/gif'))).toEqual(['UNSUPPORTED_FORMAT']);
    expect(await codes(file(PNG, 'photo.webp', 'image/webp'))).toEqual(['UNSUPPORTED_FORMAT']);
  });

  it('rejects files whose content does not match an allowed format', async () => {
    const [reason] = await validateFile(file([...'GIF89a'].map((c) => c.charCodeAt(0)), 'renamed.jpg', 'image/jpeg'));
    expect(reason).toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: expect.stringContaining("contents") });
  });

  it('rejects AVIF disguised as HEIC', async () => {
    const avif = [0, 0, 0, 24, ...'ftypavif'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c));
    expect(await codes(file(avif, 'photo.heic'))).toEqual(['UNSUPPORTED_FORMAT']);
  });

  it('rejects empty and oversized files', async () => {
    expect(await codes(new File([], 'empty.jpg', { type: 'image/jpeg' }))).toEqual(['EMPTY_FILE']);
    expect(await codes(file(JPEG, 'huge.jpg', 'image/jpeg', 21 * 1024 * 1024))).toEqual(['FILE_TOO_LARGE']);
  });
});
