import {
  AlignmentTracker,
  computeGuidance,
  DEFAULT_GUIDANCE,
  type GuidanceConfig,
} from '../src/guidance/computeGuidance';
import type { DetectionResult } from '../src/detection/types';

const noTouch = { left: false, right: false, top: false, bottom: false };

function det(x: number, y: number, w: number, h: number, touches = noTouch): DetectionResult {
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
    touches,
    confidence: 1,
  };
}

const target: GuidanceConfig = { ...DEFAULT_GUIDANCE, directionMode: 'target' };
const phone: GuidanceConfig = { ...DEFAULT_GUIDANCE, directionMode: 'phone' };

describe('computeGuidance', () => {
  it('không thấy tài liệu', () => {
    expect(computeGuidance({ found: false, reason: 'none' })).toBe('notFound');
    expect(computeGuidance({ found: false, reason: 'lowContrast' })).toBe('lowContrast');
  });

  it('đã căn giữa và đủ lớn -> giữ yên', () => {
    expect(computeGuidance(det(0.2, 0.2, 0.6, 0.6), target)).toBe('hold');
  });

  it.each([
    // [mô tả, bbox, target-mode, phone-mode]
    ['lệch phải', det(0.35, 0.2, 0.6, 0.6), 'left', 'right'],
    ['lệch trái', det(0.05, 0.2, 0.6, 0.6), 'right', 'left'],
    ['lệch xuống', det(0.2, 0.35, 0.6, 0.6), 'up', 'down'],
    ['lệch lên', det(0.2, 0.05, 0.6, 0.6), 'down', 'up'],
  ] as const)('%s', (_, d, t, p) => {
    expect(computeGuidance(d, target)).toBe(t);
    expect(computeGuidance(d, phone)).toBe(p);
  });

  it('ưu tiên trục lệch nhiều hơn', () => {
    // lệch phải 0.12, lệch xuống 0.25
    expect(computeGuidance(det(0.32, 0.45, 0.6, 0.6), target)).toBe('up');
  });

  it('quá nhỏ -> lại gần', () => {
    expect(computeGuidance(det(0.35, 0.35, 0.3, 0.3), target)).toBe('closer');
  });

  it('quá lớn -> ra xa', () => {
    expect(computeGuidance(det(0.02, 0.02, 0.96, 0.96), target)).toBe('farther');
  });

  it('chạm 2 cạnh đối diện -> ra xa', () => {
    const touches = { ...noTouch, left: true, right: true };
    expect(computeGuidance(det(0, 0.3, 1, 0.4, touches), target)).toBe('farther');
  });

  it('nhỏ và lệch -> căn giữa trước rồi mới lại gần', () => {
    expect(computeGuidance(det(0.6, 0.35, 0.3, 0.3), target)).toBe('left');
  });
});

describe('AlignmentTracker', () => {
  it('cần đủ số khung hold liên tiếp mới aligned, báo justAligned đúng 1 lần', () => {
    const t = new AlignmentTracker(3, 2);
    expect(t.update('hold').aligned).toBe(false);
    expect(t.update('hold').aligned).toBe(false);
    const s = t.update('hold');
    expect(s).toEqual({ instruction: 'hold', aligned: true, justAligned: true });
    expect(t.update('hold').justAligned).toBe(false);
  });

  it('một khung lệch đơn lẻ không làm mất aligned', () => {
    const t = new AlignmentTracker(2, 2);
    t.update('hold');
    t.update('hold');
    expect(t.update('left').aligned).toBe(true);
    expect(t.update('hold').aligned).toBe(true);
  });

  it('lệch liên tiếp thì mất aligned và trả lại chỉ dẫn', () => {
    const t = new AlignmentTracker(2, 2);
    t.update('hold');
    t.update('hold');
    t.update('left');
    expect(t.update('left')).toEqual({ instruction: 'left', aligned: false, justAligned: false });
  });

  it('một khung nhiễu không làm đổi chỉ dẫn', () => {
    const t = new AlignmentTracker(10, 2, 2);
    t.update('left');
    t.update('left');
    expect(t.update('up').instruction).toBe('left');
    expect(t.update('left').instruction).toBe('left');
    t.update('up');
    expect(t.update('up').instruction).toBe('up');
  });

  it('khung không hold xen giữa sẽ reset chuỗi', () => {
    const t = new AlignmentTracker(3, 2);
    t.update('hold');
    t.update('hold');
    t.update('closer');
    expect(t.update('hold').aligned).toBe(false);
  });
});
