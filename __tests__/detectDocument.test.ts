import { detectDocument, otsu, rgbaToGray } from '../src/detection/detectDocument';
import { syntheticDoc } from './helpers';

describe('detectDocument', () => {
  it('tìm được tài liệu ở giữa khung với bbox chính xác', () => {
    const r = detectDocument(syntheticDoc({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }));
    expect(r.found).toBe(true);
    if (!r.found) return;
    expect(r.bbox.x).toBeCloseTo(0.2, 1);
    expect(r.bbox.y).toBeCloseTo(0.2, 1);
    expect(r.bbox.w).toBeCloseTo(0.6, 1);
    expect(r.bbox.h).toBeCloseTo(0.6, 1);
    expect(r.areaRatio).toBeCloseTo(0.36, 1);
    expect(r.touches).toEqual({ left: false, right: false, top: false, bottom: false });
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('ước lượng 4 góc theo thứ tự TL, TR, BR, BL', () => {
    const r = detectDocument(syntheticDoc({ x: 0.1, y: 0.3, w: 0.5, h: 0.4 }));
    if (!r.found) throw new Error('expected found');
    const [tl, tr, br, bl] = r.corners;
    expect(tl.x).toBeLessThan(tr.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect(br.x).toBeGreaterThan(bl.x);
    expect(br.y).toBeGreaterThan(tr.y);
  });

  it('đánh dấu cạnh bị chạm khi tài liệu tràn ra khỏi khung', () => {
    const r = detectDocument(syntheticDoc({ x: 0.5, y: 0.2, w: 0.5, h: 0.5 }));
    if (!r.found) throw new Error('expected found');
    expect(r.touches.right).toBe(true);
    expect(r.touches.left).toBe(false);
  });

  it('trả về lowContrast khi ảnh gần như đồng màu', () => {
    const r = detectDocument(syntheticDoc(null, { bg: 120, noise: 4 }));
    expect(r).toEqual({ found: false, reason: 'lowContrast' });
  });

  it('trả về lowContrast khi giấy và nền cùng màu', () => {
    const r = detectDocument(syntheticDoc({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, { bg: 200, fg: 215 }));
    expect(r.found).toBe(false);
  });

  it('bỏ qua đốm sáng quá nhỏ', () => {
    const r = detectDocument(syntheticDoc({ x: 0.5, y: 0.5, w: 0.05, h: 0.05 }));
    expect(r).toEqual({ found: false, reason: 'none' });
  });

  it('coi vùng sáng phủ kín khung là tài liệu quá gần', () => {
    const img = syntheticDoc({ x: 0, y: 0, w: 1, h: 0.95 });
    const r = detectDocument(img);
    if (!r.found) throw new Error('expected found');
    expect(r.areaRatio).toBeGreaterThan(0.9);
  });

  it('bỏ qua nền sáng có vật tối lớn ở giữa', () => {
    // Nền sáng, "tài liệu" tối ở giữa: không đúng giả định -> không nhận nhầm nền là giấy.
    const r = detectDocument(syntheticDoc({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, { bg: 215, fg: 50 }));
    expect(r.found).toBe(false);
  });
});

describe('helpers', () => {
  it('rgbaToGray chuyển trắng/đen đúng', () => {
    const g = rgbaToGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(g.data[0]).toBeGreaterThan(250);
    expect(g.data[1]).toBe(0);
  });

  it('otsu tách 2 cụm sáng/tối', () => {
    const data = new Uint8Array(200);
    data.fill(30, 0, 100);
    data.fill(220, 100);
    const { threshold } = otsu(data);
    expect(threshold).toBeGreaterThanOrEqual(30);
    expect(threshold).toBeLessThan(220);
  });
});
