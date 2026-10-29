import type { GrayImage } from '../src/detection/types';

/** Ảnh tổng hợp: nền tối + một hình chữ nhật sáng (tọa độ chuẩn hóa 0..1). */
export function syntheticDoc(
  rect: { x: number; y: number; w: number; h: number } | null,
  opts: { width?: number; height?: number; bg?: number; fg?: number; noise?: number } = {},
): GrayImage {
  const { width = 160, height = 200, bg = 50, fg = 215, noise = 10 } = opts;
  const data = new Uint8Array(width * height);
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const x0 = rect ? Math.round(rect.x * width) : 0;
  const y0 = rect ? Math.round(rect.y * height) : 0;
  const x1 = rect ? Math.round((rect.x + rect.w) * width) : 0;
  const y1 = rect ? Math.round((rect.y + rect.h) * height) : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = rect && x >= x0 && x < x1 && y >= y0 && y < y1;
      const v = (inside ? fg : bg) + (rand() - 0.5) * 2 * noise;
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { width, height, data };
}
