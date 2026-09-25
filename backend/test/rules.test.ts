import { checkFileSize, evaluateContent, type ImageMetrics, type Thresholds } from '../src/processing/rules.js';

const thresholds: Thresholds = {
  minFileBytes: 10_000,
  minWidth: 400,
  minHeight: 400,
  blurThreshold: 50,
  faceMinHeightRatio: 0.15,
};

const face = (height: number) => ({ score: 0.99, x: 0.3, y: 0.3, width: height * 0.8, height });
const good: ImageMetrics = { width: 1200, height: 900, blurScore: 300, faces: [face(0.4)] };
const codes = (m: Partial<ImageMetrics>) => evaluateContent({ ...good, ...m }, thresholds).map((r) => r.code);

describe('validation rules', () => {
  it('accepts an image that passes every rule', () => {
    expect(codes({})).toEqual([]);
  });

  it('accepts an image without any face', () => {
    expect(codes({ faces: [] })).toEqual([]);
  });

  it('rejects files that are too small', () => {
    expect(checkFileSize(9_999, thresholds)?.code).toBe('FILE_TOO_SMALL');
    expect(checkFileSize(10_000, thresholds)).toBeNull();
  });

  it('rejects low resolution on either axis', () => {
    expect(codes({ width: 399 })).toEqual(['RESOLUTION_TOO_LOW']);
    expect(codes({ height: 399 })).toEqual(['RESOLUTION_TOO_LOW']);
  });

  it('rejects blurry images', () => {
    expect(codes({ blurScore: 49.9 })).toEqual(['BLURRY']);
  });

  it('rejects multiple faces', () => {
    expect(codes({ faces: [face(0.3), face(0.3)] })).toEqual(['MULTIPLE_FACES']);
  });

  it('rejects a face that is too small', () => {
    expect(codes({ faces: [face(0.1)] })).toEqual(['FACE_TOO_SMALL']);
  });

  it('reports every failing rule at once', () => {
    expect(codes({ width: 200, blurScore: 1, faces: [face(0.05), face(0.02)] })).toEqual([
      'RESOLUTION_TOO_LOW',
      'BLURRY',
      'MULTIPLE_FACES',
      'FACE_TOO_SMALL',
    ]);
  });

  it('writes human-readable messages', () => {
    const [r] = evaluateContent({ ...good, width: 320, height: 240 }, thresholds);
    expect(r?.message).toBe('Resolution is 320×240px; the minimum is 400×400px.');
  });
});
