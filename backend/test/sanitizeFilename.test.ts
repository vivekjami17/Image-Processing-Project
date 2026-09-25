import { sanitizeFilename } from '../src/images/imageService.js';

describe('sanitizeFilename', () => {
  it.each([
    ['photo.jpg', 'photo.jpg'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\IMG_1.HEIC', 'IMG_1.HEIC'],
    ['bad\u0000na\u001fme.png', 'badname.png'],
    ['   ', 'untitled'],
    ['dir/', 'untitled'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('truncates to 255 characters', () => {
    expect(sanitizeFilename('a'.repeat(300) + '.jpg')).toHaveLength(255);
  });
});
