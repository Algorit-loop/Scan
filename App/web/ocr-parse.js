/**
 * Đọc kết quả TSV của Tesseract (GetTSVText) thành danh sách dòng chữ có cấu trúc.
 * Mỗi hàng TSV: level, page, block, par, line, word, left, top, width, height, conf, text
 *   (level 2 = khối, 3 = đoạn, 4 = dòng, 5 = từ). Chỉ lấy hàng từ (5); khối / đoạn / dòng suy ra từ các số thứ tự.
 * Tọa độ chia cho `scale` (ảnh OCR đã đổi cỡ) để về hệ tọa độ ảnh gốc.
 *
 * Trả [{ block, par, line, box: [x1, y1, x2, y2], words: [{ text, conf (0..100), box }] }] theo thứ tự đọc của Tesseract.
 * Thuần JS: chạy trong Worker OCR và trong Node để test.
 */
var OcrParse = (function () {
  function parseTsv(tsv, scale) {
    var k = 1 / (scale || 1);
    var lines = [];
    var cur = null;
    var rows = String(tsv || '').split('\n');
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i].split('\t');
      if (c.length < 12 || c[0] !== '5') continue;
      var text = c.slice(11).join('\t').trim();
      if (!text) continue;
      var x = Number(c[6]) * k;
      var y = Number(c[7]) * k;
      var box = [x, y, x + Number(c[8]) * k, y + Number(c[9]) * k];
      var block = Number(c[2]);
      var par = Number(c[3]);
      var line = Number(c[4]);
      if (!cur || cur.block !== block || cur.par !== par || cur.line !== line) {
        cur = { block: block, par: par, line: line, box: box.slice(), words: [] };
        lines.push(cur);
      } else {
        cur.box[0] = Math.min(cur.box[0], box[0]);
        cur.box[1] = Math.min(cur.box[1], box[1]);
        cur.box[2] = Math.max(cur.box[2], box[2]);
        cur.box[3] = Math.max(cur.box[3], box[3]);
      }
      cur.words.push({ text: text, conf: Number(c[10]), box: box });
    }
    return lines;
  }

  return { parseTsv: parseTsv };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OcrParse;
