import { detectImageFormat } from '../src/processing/fileSignature.js';
import { fixture } from './helpers.js';

function ftyp(major: string, compatible: string[]): Uint8Array {
  const brands = [major, '\0\0\0\0', ...compatible].join('');
  const size = 8 + brands.length;
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(size, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write(brands, 8, 'latin1');
  return buf;
}

describe('detectImageFormat', () => {
  it('recognises JPEG and PNG by magic bytes', () => {
    expect(detectImageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageFormat(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
  });

  it('recognises a real HEIC file', async () => {
    expect(detectImageFormat(await fixture('landscape.heic'))).toBe('heic');
  });

  it('accepts HEIC brands whether major or compatible', () => {
    expect(detectImageFormat(ftyp('heic', ['mif1']))).toBe('heic');
    expect(detectImageFormat(ftyp('mif1', ['heic']))).toBe('heic');
  });

  it('rejects AVIF, which shares the HEIF container', () => {
    expect(detectImageFormat(ftyp('avif', ['mif1', 'miaf']))).toBeNull();
    expect(detectImageFormat(ftyp('mif1', ['avif']))).toBeNull();
  });

  it('ignores extensions and rejects other content', () => {
    expect(detectImageFormat(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageFormat(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });
});
