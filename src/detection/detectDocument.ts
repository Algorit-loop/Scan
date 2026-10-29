import type { DetectionResult, GrayImage, NormPoint } from './types';

/**
 * Phát hiện tài liệu (vùng sáng hình chữ nhật) trên ảnh xám nhỏ (~160px).
 *
 * Thuật toán: làm mờ 3x3 -> ngưỡng Otsu -> tìm vùng liên thông sáng lớn nhất,
 * đủ "đặc" (gần hình chữ nhật). Giả định giấy sáng hơn nền — trường hợp phổ biến
 * khi đặt tài liệu trên bàn. Nếu tương phản quá thấp thì trả về `lowContrast`
 * để app hướng dẫn người dùng đổi nền thay vì đoán bừa.
 */

export type DetectOptions = {
  /** Chênh lệch tối thiểu giữa độ sáng trung bình 2 lớp Otsu. */
  minContrast: number;
  /** Diện tích tối thiểu của vùng (tỉ lệ khung hình). */
  minAreaRatio: number;
  /** area / bboxArea tối thiểu — loại vùng méo/lởm chởm. */
  minFill: number;
  /** Vùng chạm cả 4 cạnh chỉ được coi là tài liệu nếu phủ ít nhất tỉ lệ này. */
  fullFrameAreaRatio: number;
};

export const DEFAULT_DETECT_OPTIONS: DetectOptions = {
  minContrast: 35,
  minAreaRatio: 0.02,
  minFill: 0.55,
  fullFrameAreaRatio: 0.85,
};

export function rgbaToGray(rgba: Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    // Hệ số luma BT.601 dạng số nguyên.
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return { width, height, data };
}

export function boxBlur3(img: GrayImage): GrayImage {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += data[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = (sum / n) | 0;
    }
  }
  return { width: w, height: h, data: out };
}

export function otsu(data: Uint8Array): { threshold: number; meanLow: number; meanHigh: number } {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const total = data.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumLow = 0;
  let countLow = 0;
  let best = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    countLow += hist[t];
    if (countLow === 0) continue;
    const countHigh = total - countLow;
    if (countHigh === 0) break;
    sumLow += t * hist[t];
    const mL = sumLow / countLow;
    const mH = (sumAll - sumLow) / countHigh;
    const between = countLow * countHigh * (mL - mH) * (mL - mH);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  let lo = 0;
  let nLo = 0;
  let hi = 0;
  let nHi = 0;
  for (let t = 0; t < 256; t++) {
    if (t <= threshold) {
      lo += t * hist[t];
      nLo += hist[t];
    } else {
      hi += t * hist[t];
      nHi += hist[t];
    }
  }
  return {
    threshold,
    meanLow: nLo ? lo / nLo : 0,
    meanHigh: nHi ? hi / nHi : 255,
  };
}

type Component = {
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  // Điểm cực trị để ước lượng 4 góc.
  tl: [number, number, number]; // min(x+y)
  br: [number, number, number]; // max(x+y)
  tr: [number, number, number]; // max(x-y)
  bl: [number, number, number]; // min(x-y)
};

function findComponents(mask: Uint8Array, w: number, h: number): Component[] {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps: Component[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = comps.length + 1;
    const sx = start % w;
    const sy = (start / w) | 0;
    const c: Component = {
      area: 0,
      minX: sx,
      maxX: sx,
      minY: sy,
      maxY: sy,
      tl: [sx, sy, sx + sy],
      br: [sx, sy, sx + sy],
      tr: [sx, sy, sx - sy],
      bl: [sx, sy, sx - sy],
    };

    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top > 0) {
      const p = stack[--top];
      const x = p % w;
      const y = (p / w) | 0;
      c.area++;
      if (x < c.minX) c.minX = x;
      if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y;
      if (y > c.maxY) c.maxY = y;
      const s = x + y;
      const d = x - y;
      if (s < c.tl[2]) c.tl = [x, y, s];
      if (s > c.br[2]) c.br = [x, y, s];
      if (d > c.tr[2]) c.tr = [x, y, d];
      if (d < c.bl[2]) c.bl = [x, y, d];

      if (x > 0 && mask[p - 1] && !labels[p - 1]) {
        labels[p - 1] = label;
        stack[top++] = p - 1;
      }
      if (x < w - 1 && mask[p + 1] && !labels[p + 1]) {
        labels[p + 1] = label;
        stack[top++] = p + 1;
      }
      if (y > 0 && mask[p - w] && !labels[p - w]) {
        labels[p - w] = label;
        stack[top++] = p - w;
      }
      if (y < h - 1 && mask[p + w] && !labels[p + w]) {
        labels[p + w] = label;
        stack[top++] = p + w;
      }
    }
    comps.push(c);
  }
  return comps;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function detectDocument(
  img: GrayImage,
  options: Partial<DetectOptions> = {},
): DetectionResult {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...options };
  const { width: w, height: h } = img;
  const total = w * h;

  const blurred = boxBlur3(img);
  const { threshold, meanLow, meanHigh } = otsu(blurred.data);
  const contrast = meanHigh - meanLow;
  if (contrast < opts.minContrast) return { found: false, reason: 'lowContrast' };

  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) mask[i] = blurred.data[i] > threshold ? 1 : 0;

  let best: { c: Component; fill: number } | null = null;
  for (const c of findComponents(mask, w, h)) {
    if (c.area < opts.minAreaRatio * total) continue;
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const fill = c.area / (bw * bh);
    if (fill < opts.minFill) continue;

    const touchesAll = c.minX === 0 && c.minY === 0 && c.maxX === w - 1 && c.maxY === h - 1;
    // Vùng sáng phủ kín khung nhưng có "lỗ" tối lớn => đó là nền sáng, không phải giấy.
    if (touchesAll && c.area < opts.fullFrameAreaRatio * total) continue;

    if (!best || c.area > best.c.area) best = { c, fill };
  }

  if (!best) return { found: false, reason: 'none' };

  const { c, fill } = best;
  const pt = (p: [number, number, number]): NormPoint => ({ x: (p[0] + 0.5) / w, y: (p[1] + 0.5) / h });
  const bbox = {
    x: c.minX / w,
    y: c.minY / h,
    w: (c.maxX - c.minX + 1) / w,
    h: (c.maxY - c.minY + 1) / h,
  };

  return {
    found: true,
    bbox,
    corners: [pt(c.tl), pt(c.tr), pt(c.br), pt(c.bl)],
    areaRatio: bbox.w * bbox.h,
    touches: {
      left: c.minX === 0,
      right: c.maxX === w - 1,
      top: c.minY === 0,
      bottom: c.maxY === h - 1,
    },
    confidence: clamp01((contrast - opts.minContrast) / 80) * clamp01(fill),
  };
}
