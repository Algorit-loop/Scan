import type { DetectionResult } from '../src/detection/types';
import { cropFor } from '../src/scan/crop';

const noTouch = { left: false, right: false, top: false, bottom: false };

function found(x: number, y: number, w: number, h: number, confidence = 0.9): DetectionResult {
  return {
    found: true,
    bbox: { x, y, w, h },
    corners: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    areaRatio: w * h,
    touches: noTouch,
    confidence,
  };
}

describe('cropFor', () => {
  it('cắt quanh tài liệu kèm lề nhỏ', () => {
    const c = cropFor(found(0.2, 0.2, 0.6, 0.6), 1000, 2000)!;
    expect(c.originX).toBe(170); // (0.2 - 0.03) * 1000
    expect(c.originY).toBe(340);
    expect(c.width).toBe(660); // (0.6 + 2 * 0.03) * 1000
    expect(c.height).toBe(1320);
  });

  it('không vượt ra ngoài ảnh', () => {
    const c = cropFor(found(0, 0.1, 1, 0.5), 1000, 1000)!;
    expect(c.originX).toBe(0);
    expect(c.originX + c.width).toBeLessThanOrEqual(1000);
  });

  it('không cắt khi tài liệu gần phủ kín khung, hoặc không tin cậy, hoặc không thấy', () => {
    expect(cropFor(found(0.01, 0.01, 0.98, 0.98), 1000, 1000)).toBeUndefined();
    expect(cropFor(found(0.2, 0.2, 0.6, 0.6, 0.1), 1000, 1000)).toBeUndefined();
    expect(cropFor({ found: false, reason: 'none' }, 1000, 1000)).toBeUndefined();
    expect(cropFor(null, 1000, 1000)).toBeUndefined();
  });
});
