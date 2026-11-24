// web/layout.js là script thường (chạy trong WebView) nhưng có module.exports để test.
// Khớp với PaddleX end-to-end (model thật) kiểm bằng: npm run check:layout -- ảnh.jpg (xem scripts/check-layout.mjs).
import { LAYOUT_LABELS } from '../layout/labels';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Layout = require('../../web/layout.js');

type Det = [number, number, number, number, number, number];
const flat = (rows: Det[]) => new Float32Array(rows.flat());
const LABEL = (name: string) => Layout.LABELS.indexOf(name);

describe('Layout', () => {
  it('số lớp như inference.yml (S và L cùng 23 lớp) và lớp nào cũng có tên tiếng Việt', () => {
    expect(Layout.MODELS.S.labels).toHaveLength(23);
    expect(Layout.MODELS.L.labels).toEqual(Layout.MODELS.S.labels);
    const all = new Set<string>([...Layout.MODELS.S.labels, ...Layout.MODELS.L.labels]);
    expect(Object.keys(LAYOUT_LABELS).sort()).toEqual([...all].sort());
  });

  describe('hướng trang', () => {
    it('nhãn = góc ảnh đang bị xoay theo chiều kim đồng hồ -> xoay thêm 360 - nhãn; điểm thấp thì không xoay', () => {
      expect(Layout.orientation([0.9, 0.05, 0.03, 0.02])).toEqual({ angle: 0, score: 0.9, rotate: 0 });
      expect(Layout.orientation([0.1, 0.8, 0.05, 0.05]).rotate).toBe(270);
      expect(Layout.orientation([0.05, 0.05, 0.1, 0.8]).rotate).toBe(90); // biên bản mẫu: model đoán 270, xoay 90° là thẳng
      expect(Layout.orientation([0.05, 0.05, 0.75, 0.15]).rotate).toBe(180);
      expect(Layout.orientation([0.3, 0.41, 0.2, 0.09])).toEqual({ angle: 90, score: 0.41, rotate: 0 });
    });

    it('rotateRGBA xoay theo chiều kim đồng hồ', () => {
      // Ảnh 3x2, mỗi điểm ảnh mang số thứ tự ở kênh R.
      const w = 3;
      const h = 2;
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) rgba[i * 4] = i; // [0 1 2 / 3 4 5]
      const r = (deg: number) => {
        const o = Layout.rotateRGBA(rgba, w, h, deg);
        return { w: o.w, h: o.h, px: Array.from({ length: o.w * o.h }, (_, i) => o.data[i * 4]) };
      };
      expect(r(90)).toEqual({ w: 2, h: 3, px: [3, 0, 4, 1, 5, 2] });
      expect(r(180)).toEqual({ w: 3, h: 2, px: [5, 4, 3, 2, 1, 0] });
      expect(r(270)).toEqual({ w: 2, h: 3, px: [2, 5, 1, 4, 0, 3] });
      expect(r(0).px).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('tiền xử lý doc_ori ra 3x224x224, chuẩn hóa ImageNet', () => {
      const w = 300;
      const h = 500;
      const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
      const x = Layout.orientationPreprocess(rgba, w, h);
      expect(x).toHaveLength(3 * 224 * 224);
      expect(x[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    });
  });

  describe('preprocess', () => {
    it('ra tensor 1x3x480x480 đã chuẩn hóa ImageNet và scale_factor [480/h, 480/w]', () => {
      const w = 37;
      const h = 23;
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) rgba.set([255, 128, 0, 255], i * 4);
      const { data, scale } = Layout.preprocess(rgba, w, h);
      const S = 480;
      expect(data).toHaveLength(3 * S * S);
      expect(scale[0]).toBeCloseTo(S / h, 5);
      expect(scale[1]).toBeCloseTo(S / w, 5);
      // Ảnh một màu: resize giữ nguyên màu (tổng trọng số bicubic = 1), kênh R/G/B nằm ở 3 mặt phẳng liên tiếp.
      expect(data[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
      expect(data[S * S + 1234]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 4);
      expect(data[2 * S * S + S * S - 1]).toBeCloseTo((0 - 0.406) / 0.225, 4);
    });

    it('L: 640x640, chỉ chia 255 (không chuẩn hóa ImageNet), cần im_shape', () => {
      const rgba = new Uint8ClampedArray(20 * 10 * 4);
      for (let i = 0; i < 200; i++) rgba.set([255, 51, 0, 255], i * 4);
      const p = Layout.preprocess(rgba, 20, 10, { model: 'L' });
      const S = 640;
      expect(p.side).toBe(S);
      expect(p.imShape).toBe(true);
      expect(p.data).toHaveLength(3 * S * S);
      expect(p.data[0]).toBeCloseTo(1, 5);
      expect(p.data[S * S]).toBeCloseTo(0.2, 5);
      expect(p.data[2 * S * S]).toBeCloseTo(0, 5);
      expect(p.scale[0]).toBeCloseTo(64, 5);
      expect(p.scale[1]).toBeCloseTo(32, 5);
    });

    it('giữ thứ tự hàng/cột: nửa trên trắng, nửa dưới đen', () => {
      const w = 40;
      const h = 40;
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) rgba.set(y < h / 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * w + x) * 4);
      const { data } = Layout.preprocess(rgba, w, h);
      const S = 480;
      expect(data[10 * S + 100]).toBeGreaterThan(2); // trắng
      expect(data[470 * S + 100]).toBeLessThan(-2); // đen
    });
  });

  describe('postprocess', () => {
    const W = 1000;
    const H = 1400;

    it('lọc điểm theo ngưỡng (lớn hơn hẳn) và bỏ lớp -1', () => {
      const out = Layout.postprocess(
        flat([
          [LABEL('text'), 0.8, 10, 10, 200, 50],
          [LABEL('text'), 0.29, 10, 300, 200, 350], // (0.3 ở float32 là 0.30000001 > 0.3, như numpy ở PaddleX)
          [-1, 0.9, 10, 500, 200, 550],
        ]),
        3,
        W,
        H,
      );
      expect(out.map((r: { score: number }) => r.score)).toEqual([expect.closeTo(0.8, 5)]);
    });

    it('L dùng cùng bảng nhãn với S (lớp 9 là table_title)', () => {
      const out = Layout.postprocess(flat([[9, 0.8, 10, 10, 200, 50]]), 1, W, H, { model: 'L' });
      expect(out[0].label).toBe('table_title');
      expect(Layout.postprocess(flat([[9, 0.8, 10, 10, 200, 50]]), 1, W, H)[0].label).toBe('table_title');
    });

    it('chỉ đọc num dòng đầu (phần sau là đệm)', () => {
      const out = Layout.postprocess(
        flat([
          [LABEL('text'), 0.8, 10, 10, 200, 50],
          [LABEL('table'), 0.9, 10, 300, 200, 350],
        ]),
        1,
        W,
        H,
      );
      expect(out).toHaveLength(1);
    });

    it('layout_nms: cùng lớp chồng >= 0.6 thì bỏ, khác lớp chỉ bỏ khi chồng >= 0.98', () => {
      const out = Layout.postprocess(
        flat([
          [LABEL('text'), 0.9, 100, 100, 500, 300],
          [LABEL('text'), 0.5, 110, 105, 505, 300], // trùng lớp, IoU ~0.95 -> bỏ
          [LABEL('table'), 0.6, 110, 105, 505, 300], // khác lớp, IoU < 0.98 -> giữ
          [LABEL('image'), 0.4, 100, 100, 500, 300], // khác lớp, IoU = 1 -> bỏ
        ]),
        4,
        W,
        H,
      );
      expect(out.map((r: { label: string }) => r.label).sort()).toEqual(['table', 'text']);
    });

    it('bỏ khung "image" phủ gần hết trang (dọc > 93%), trừ khi đó là khung duy nhất', () => {
      const big: Det = [LABEL('image'), 0.7, 0, 0, W, H * 0.97];
      const text: Det = [LABEL('text'), 0.6, 50, 50, 400, 120];
      expect(Layout.postprocess(flat([big, text]), 2, W, H).map((r: { label: string }) => r.label)).toEqual(['text']);
      expect(Layout.postprocess(flat([big]), 1, W, H)).toHaveLength(1);
    });

    it('cắt khung vào ảnh, bỏ khung rỗng, trả tọa độ chuẩn hóa', () => {
      const out = Layout.postprocess(
        flat([
          [LABEL('text'), 0.8, -20, -5, 500, 700],
          [LABEL('text'), 0.8, 1200, 10, 1300, 50], // nằm ngoài ảnh
        ]),
        2,
        W,
        H,
      );
      expect(out).toHaveLength(1);
      expect(out[0].box).toEqual([0, 0, 500, 700]);
      expect(out[0].norm).toEqual([0, 0, 0.5, 0.5]);
    });

    it('thứ tự đọc: trên xuống, cùng dòng trái sang phải; khung rất cao không nuốt khung nhỏ', () => {
      const out = Layout.postprocess(
        flat([
          [LABEL('text'), 0.8, 520, 400, 950, 600], // cột phải, dòng 2
          [LABEL('text'), 0.8, 50, 410, 480, 590], // cột trái, dòng 2
          [LABEL('image'), 0.8, 50, 180, 950, 1300], // khung rất cao bắt đầu trước dòng 2
          [LABEL('doc_title'), 0.8, 200, 190, 800, 260], // tiêu đề nằm trong vùng ảnh nhưng cao khác hẳn
          [LABEL('header'), 0.8, 50, 20, 300, 60],
        ]),
        5,
        W,
        H,
      );
      expect(out.map((r: { label: string; index: number }) => `${r.index}:${r.label}`)).toEqual([
        '1:header',
        '2:image',
        '3:doc_title',
        '4:text',
        '5:text',
      ]);
      expect(out[3].box[0]).toBe(50); // cột trái trước
    });
  });
});
