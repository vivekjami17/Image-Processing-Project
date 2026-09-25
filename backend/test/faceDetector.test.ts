import { suppressOverlapping, type FaceBox } from '../src/processing/faceDetector.js';

const box = (partial: Partial<FaceBox>): FaceBox => ({ score: 0.9, x: 0, y: 0, width: 0.2, height: 0.2, ...partial });

describe('suppressOverlapping', () => {
  it('keeps every box when none overlap', () => {
    const boxes = [box({ x: 0, y: 0 }), box({ x: 0.5, y: 0.5 }), box({ x: 0.8, y: 0 })];
    expect(suppressOverlapping(boxes, 0.3)).toHaveLength(3);
  });

  it('merges two near-identical detections of the same face into one', () => {
    // Two quadrant passes finding essentially the same face, offset by a couple percent.
    const a = box({ score: 0.95, x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
    const b = box({ score: 0.8, x: 0.11, y: 0.1, width: 0.2, height: 0.2 });
    const result = suppressOverlapping([a, b], 0.3);
    expect(result).toEqual([a]);
  });

  it('keeps the highest-scoring box of an overlapping pair regardless of input order', () => {
    const low = box({ score: 0.5, x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
    const high = box({ score: 0.95, x: 0.12, y: 0.1, width: 0.2, height: 0.2 });
    expect(suppressOverlapping([low, high], 0.3)).toEqual([high]);
  });

  it('keeps boxes that only overlap a little', () => {
    // Two 0.2x0.2 boxes offset by 0.18 on the x-axis: a thin sliver of overlap, IoU well under 0.3.
    const a = box({ x: 0, y: 0 });
    const b = box({ x: 0.18, y: 0 });
    expect(suppressOverlapping([a, b], 0.3)).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(suppressOverlapping([a, b], 0.3)).toHaveLength(2);
  });

  it('drops boxes right at the overlap boundary consistently with a strict >', () => {
    // Two identical 0.2x0.2 boxes offset by 0.1 on the x-axis: intersection is a
    // 0.1x0.2 rectangle, union works out to exactly IoU = 1/3 > 0.3, so they merge.
    const a = box({ score: 0.9, x: 0, y: 0 });
    const b = box({ score: 0.6, x: 0.1, y: 0 });
    expect(suppressOverlapping([a, b], 0.3)).toEqual([a]);
  });

  it('returns an empty array for no input', () => {
    expect(suppressOverlapping([], 0.3)).toEqual([]);
  });
});
