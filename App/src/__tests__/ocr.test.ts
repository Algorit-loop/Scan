// web/ocr-prep.js và web/ocr-parse.js là script thường (chạy trong Worker OCR) nhưng có module.exports để test.
// Độ chính xác end-to-end (Tesseract thật) kiểm bằng: npm run check:ocr -- ảnh.jpg (xem scripts/check-ocr.mjs).

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OcrPrep = require('../../web/ocr-prep.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OcrParse = require('../../web/ocr-parse.js');

describe('OcrPrep', () => {
  it('chọn hệ số đổi cỡ: ảnh nhỏ phóng to (có trần), ảnh vừa giữ nguyên, ảnh quá lớn thu nhỏ', () => {
    expect(OcrPrep.chooseScale(700, 990)).toBeCloseTo(2.2, 5); // 1600/700 = 2,29 -> trần 2,2
    expect(OcrPrep.chooseScale(1000, 1415)).toBeCloseTo(1.6, 5);
    expect(OcrPrep.chooseScale(1350, 1910)).toBe(1);
    expect(OcrPrep.chooseScale(3000, 4000)).toBeCloseTo(0.75, 5);
  });

  it('khử bóng: nền sáng không đều thành trắng, nét chữ vẫn đen', () => {
    // Cỡ gần với ảnh thật (lưới nền 8 px, làm mờ ~50 px chỉ là vài % bề rộng trang).
    const w = 1280;
    const h = 480;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const isInk = (x: number, y: number) => y % 40 >= 18 && y % 40 < 22 && x % 16 < 10; // các vạch ngang như dòng chữ
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const paper = 120 + (120 * x) / w; // trái tối (bóng đổ), phải sáng
        const v = isInk(x, y) ? paper * 0.25 : paper;
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    }
    const g = OcrPrep.flatten(OcrPrep.toGray(rgba, w, h), w, h);
    const at = (x: number, y: number) => g[y * w + x];
    // Giấy: gần trắng ở cả vùng bóng lẫn vùng sáng.
    expect(at(40, 5)).toBeGreaterThan(235);
    expect(at(1240, 5)).toBeGreaterThan(235);
    // Mực: vẫn tối ở cả hai vùng, tương phản như nhau (trước khi khử: 30 so với 58).
    expect(at(36, 20)).toBeLessThan(90);
    expect(at(1236, 20)).toBeLessThan(90);
    expect(Math.abs(at(36, 20) - at(1236, 20))).toBeLessThan(25);
  });

  it('prepare: trả ảnh xám đúng cỡ + scale để quy tọa độ về ảnh gốc', () => {
    const w = 400;
    const h = 600;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(200);
    const p = OcrPrep.prepare(rgba, w, h);
    expect(p.scale).toBeCloseTo(2.2, 5);
    expect([p.w, p.h]).toEqual([880, 1320]);
    expect(p.gray).toHaveLength(880 * 1320);
    // Trang trắng trơn: phóng to + khử bóng xong vẫn trắng.
    expect(Math.min(...p.gray.subarray(0, 5000))).toBeGreaterThan(245);
  });
});

describe('OcrParse', () => {
  const row = (level: number, block: number, par: number, line: number, word: number, box: number[], conf: number, text: string) =>
    [level, 1, block, par, line, word, ...box, conf, text].join('\t');
  const tsv = [
    row(1, 0, 0, 0, 0, [0, 0, 2000, 3000], -1, ''),
    row(2, 1, 0, 0, 0, [100, 100, 800, 200], -1, ''),
    row(4, 1, 1, 1, 0, [100, 100, 800, 60], -1, ''),
    row(5, 1, 1, 1, 1, [100, 100, 200, 60], 96.5, 'Kính'),
    row(5, 1, 1, 1, 2, [320, 104, 160, 50], 91, 'gửi:'),
    row(5, 1, 1, 2, 1, [100, 180, 300, 60], 88, 'Quý'),
    row(5, 2, 1, 1, 1, [1200, 100, 240, 60], 40, '   '),
    row(5, 2, 1, 1, 2, [1200, 100, 240, 60], 73, 'cột'),
  ].join('\n');

  it('gom từ thành dòng theo khối / đoạn / dòng, bỏ hàng không phải từ và từ rỗng', () => {
    const lines = OcrParse.parseTsv(tsv, 1);
    expect(lines.map((l: { words: { text: string }[] }) => l.words.map((w) => w.text))).toEqual([['Kính', 'gửi:'], ['Quý'], ['cột']]);
    expect(lines[0]).toMatchObject({ block: 1, par: 1, line: 1, box: [100, 100, 480, 160] });
    expect(lines[0].words[0]).toEqual({ text: 'Kính', conf: 96.5, box: [100, 100, 300, 160] });
    expect(lines[2].block).toBe(2);
  });

  it('quy tọa độ về ảnh gốc theo scale của ảnh OCR', () => {
    const lines = OcrParse.parseTsv(tsv, 2);
    expect(lines[0].words[0].box).toEqual([50, 50, 150, 80]);
  });

  it('chuỗi rỗng / hỏng -> không có dòng nào', () => {
    expect(OcrParse.parseTsv('', 1)).toEqual([]);
    expect(OcrParse.parseTsv(null, 1)).toEqual([]);
  });
});
