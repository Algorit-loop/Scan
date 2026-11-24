// web/enhance.js là script thường (chạy trong Worker của trang quét) nhưng có module.exports để test.
// Xem bằng mắt trên ảnh thật: node scripts/check-enhance.mjs ảnh.jpg
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Enhance = require('../../web/enhance.js');

/** Trang giấy ám vàng, tối dần từ trái sang phải (bóng đổ), có các vạch chữ đậm. */
function shadedPage(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const isText = (x: number, y: number) => y % 20 >= 8 && y % 20 < 11 && x > 20 && x < w - 20 && x % 7 < 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const light = 1 - 0.55 * (x / w); // bên phải chỉ còn 45% ánh sáng
      const paper = [230 * light, 215 * light, 180 * light];
      const k = isText(x, y) ? 0.2 : 1;
      rgba.set([paper[0] * k, paper[1] * k, paper[2] * k, 255], (y * w + x) * 4);
    }
  }
  return { rgba, isText };
}

describe('Enhance.documentEnhance', () => {
  const w = 400;
  const h = 300;
  const { rgba, isText } = shadedPage(w, h);
  const out: Uint8ClampedArray = Enhance.documentEnhance(rgba, w, h);
  const px = (x: number, y: number) => [out[(y * w + x) * 4], out[(y * w + x) * 4 + 1], out[(y * w + x) * 4 + 2]];

  it('giữ kích thước, alpha 255, không sửa ảnh vào', () => {
    expect(out).toHaveLength(w * h * 4);
    expect(out[3]).toBe(255);
    expect(rgba[0]).toBe(230);
  });

  it('nền giấy thành trắng đều ở cả vùng sáng lẫn vùng bóng, hết ám màu', () => {
    for (const [x, y] of [[40, 4], [200, 4], [370, 4], [370, 284]]) {
      expect(isText(x, y)).toBe(false);
      for (const v of px(x, y)) expect(v).toBeGreaterThanOrEqual(245);
    }
  });

  it('chữ vẫn đậm, kể cả trong vùng bóng', () => {
    for (const [x, y] of [[30, 9], [205, 9], [366, 9]]) {
      expect(isText(x, y)).toBe(true);
      for (const v of px(x, y)) expect(v).toBeLessThanOrEqual(70);
    }
  });
});
