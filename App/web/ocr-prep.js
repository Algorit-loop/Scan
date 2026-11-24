/**
 * Tiền xử lý ảnh trước khi OCR (Tesseract): ảnh màu đã nắn phẳng -> ảnh xám 8 bit, nền trắng đều, chữ đủ lớn.
 *
 *  1. Xám hóa (độ chói).
 *  2. Đổi cỡ: chữ quá nhỏ thì phóng to (bicubic), ảnh quá lớn thì thu nhỏ (trung bình vùng) — Tesseract đọc tốt nhất
 *     khi chữ thường cao cỡ 20-30 px; ảnh lớn hơn nữa chỉ chậm thêm.
 *  3. Khử bóng: ước lượng nền giấy trên lưới thô (lọc MAX xóa nét chữ rồi làm mờ), chia từng điểm ảnh cho nền.
 *     Đây là bước quyết định: Tesseract tự tách ngưỡng toàn cục (Otsu) nên ảnh chụp có bóng đổ / sáng không đều làm
 *     mất cả mảng chữ. Đo trên bộ trang thử (Core/tools hoặc scripts/check-ocr.mjs): sai ký tự ~57% -> ~1,5%.
 *
 * Thuần JS, không phụ thuộc gì: chạy trong Worker OCR và trong Node để test.
 */
var OcrPrep = (function () {
  var DEFAULTS = {
    minShort: 1200, // cạnh ngắn dưới mức này thì phóng to...
    upTo: 1600, // ...tới mức này (nhưng không quá maxUp lần)
    maxUp: 2.2,
    maxLong: 3000, // cạnh dài trên mức này thì thu nhỏ
    cell: 8, // cạnh ô lưới ước lượng nền (px ảnh sau khi đổi cỡ)
    dilate: 3, // bán kính lọc MAX (ô): phải lớn hơn bề dày nét chữ
    blur: 6, // bán kính làm mờ nền (ô)
    minBackground: 40, // nền tối hơn mức này không coi là giấy (tránh khuếch đại nhiễu vùng đen)
  };

  function opts(o) {
    var r = {};
    for (var k in DEFAULTS) r[k] = o && o[k] != null ? o[k] : DEFAULTS[k];
    return r;
  }

  /** Hệ số đổi cỡ cho ảnh w x h. */
  function chooseScale(w, h, o) {
    o = opts(o);
    var short = Math.min(w, h);
    var long = Math.max(w, h);
    var s = 1;
    if (short < o.minShort) s = Math.min(o.maxUp, o.upTo / short);
    if (long * s > o.maxLong) s = o.maxLong / long;
    return s;
  }

  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29 + 128) >> 8;
    }
    return g;
  }

  function cubic(t, out) {
    var A = -0.75;
    var x0 = t + 1;
    var x2 = 1 - t;
    out[0] = ((A * x0 - 5 * A) * x0 + 8 * A) * x0 - 4 * A;
    out[1] = ((A + 2) * t - (A + 3)) * t * t + 1;
    out[2] = ((A + 2) * x2 - (A + 3)) * x2 * x2 + 1;
    out[3] = 1 - out[0] - out[1] - out[2];
  }

  /** Bảng lấy mẫu một trục: phóng to = bicubic (4 nhịp); thu nhỏ = trung bình vùng (start, n). */
  function upTable(src, dst) {
    var idx = new Int32Array(dst * 4);
    var wt = new Float32Array(dst * 4);
    var c = [0, 0, 0, 0];
    var scale = src / dst;
    for (var i = 0; i < dst; i++) {
      var f = (i + 0.5) * scale - 0.5;
      var s = Math.floor(f);
      cubic(f - s, c);
      for (var k = 0; k < 4; k++) {
        idx[i * 4 + k] = Math.min(src - 1, Math.max(0, s - 1 + k));
        wt[i * 4 + k] = c[k];
      }
    }
    return { idx: idx, wt: wt };
  }

  function resizeUp(g, w, h, nw, nh) {
    var tx = upTable(w, nw);
    var ty = upTable(h, nh);
    var mid = new Float32Array(h * nw);
    var x;
    var y;
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < nw; x++) {
        var b = x * 4;
        mid[y * nw + x] =
          g[row + tx.idx[b]] * tx.wt[b] +
          g[row + tx.idx[b + 1]] * tx.wt[b + 1] +
          g[row + tx.idx[b + 2]] * tx.wt[b + 2] +
          g[row + tx.idx[b + 3]] * tx.wt[b + 3];
      }
    }
    var out = new Uint8Array(nw * nh);
    for (y = 0; y < nh; y++) {
      var c = y * 4;
      var r0 = ty.idx[c] * nw;
      var r1 = ty.idx[c + 1] * nw;
      var r2 = ty.idx[c + 2] * nw;
      var r3 = ty.idx[c + 3] * nw;
      var w0 = ty.wt[c];
      var w1 = ty.wt[c + 1];
      var w2 = ty.wt[c + 2];
      var w3 = ty.wt[c + 3];
      for (x = 0; x < nw; x++) {
        var v = mid[r0 + x] * w0 + mid[r1 + x] * w1 + mid[r2 + x] * w2 + mid[r3 + x] * w3;
        out[y * nw + x] = v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0;
      }
    }
    return out;
  }

  function resizeDown(g, w, h, nw, nh) {
    var sum = new Float32Array(nw * nh);
    var cnt = new Float32Array(nw * nh);
    var xs = new Int32Array(w);
    for (var x = 0; x < w; x++) xs[x] = Math.min(nw - 1, Math.floor((x * nw) / w));
    for (var y = 0; y < h; y++) {
      var row = Math.min(nh - 1, Math.floor((y * nh) / h)) * nw;
      for (var x2 = 0; x2 < w; x2++) {
        sum[row + xs[x2]] += g[y * w + x2];
        cnt[row + xs[x2]]++;
      }
    }
    var out = new Uint8Array(nw * nh);
    for (var i = 0; i < out.length; i++) out[i] = (sum[i] / (cnt[i] || 1) + 0.5) | 0;
    return out;
  }

  function maxFilter(src, w, h, r) {
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var x;
    var y;
    var k;
    var m;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        m = 0;
        for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (src[y * w + k] > m) m = src[y * w + k];
        tmp[y * w + x] = m;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        m = 0;
        for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
        out[y * w + x] = m;
      }
    }
    return out;
  }

  function boxBlur(src, w, h, r) {
    var tmp = new Float32Array(w * h);
    var out = new Float32Array(w * h);
    var x;
    var y;
    var k;
    var s;
    var n;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        s = 0;
        n = 0;
        for (k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
          s += src[y * w + k];
          n++;
        }
        tmp[y * w + x] = s / n;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        s = 0;
        n = 0;
        for (k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
          s += tmp[k * w + x];
          n++;
        }
        out[y * w + x] = s / n;
      }
    }
    return out;
  }

  /** Chia ảnh xám cho nền giấy ước lượng (tại chỗ): giấy -> trắng, bóng đổ biến mất, chữ giữ nguyên độ tương phản. */
  function flatten(g, w, h, o) {
    o = opts(o);
    var gw = Math.max(1, Math.ceil(w / o.cell));
    var gh = Math.max(1, Math.ceil(h / o.cell));
    // Mỗi ô lấy điểm sáng nhất (giấy), không lấy trung bình: ô phủ chữ vẫn ra màu giấy.
    var grid = new Float32Array(gw * gh);
    var x;
    var y;
    for (y = 0; y < h; y++) {
      var gr = Math.floor(y / o.cell) * gw;
      for (x = 0; x < w; x++) {
        var v = g[y * w + x];
        var i = gr + Math.floor(x / o.cell);
        if (v > grid[i]) grid[i] = v;
      }
    }
    var bg = boxBlur(boxBlur(maxFilter(grid, gw, gh, o.dilate), gw, gh, o.blur), gw, gh, o.blur);
    for (var j = 0; j < bg.length; j++) if (bg[j] < o.minBackground) bg[j] = o.minBackground;
    // Nội suy song tuyến nền về cỡ ảnh rồi chia.
    for (y = 0; y < h; y++) {
      var fy = (y + 0.5) / o.cell - 0.5;
      var y0 = Math.max(0, Math.min(gh - 1, Math.floor(fy)));
      var y1 = Math.min(gh - 1, y0 + 1);
      var ty = Math.max(0, Math.min(1, fy - y0));
      for (x = 0; x < w; x++) {
        var fx = (x + 0.5) / o.cell - 0.5;
        var x0 = Math.max(0, Math.min(gw - 1, Math.floor(fx)));
        var x1 = Math.min(gw - 1, x0 + 1);
        var tx = Math.max(0, Math.min(1, fx - x0));
        var top = bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx;
        var bot = bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx;
        var b = top * (1 - ty) + bot * ty;
        var out = (g[y * w + x] * 255) / b;
        g[y * w + x] = out > 255 ? 255 : (out + 0.5) | 0;
      }
    }
    return g;
  }

  /**
   * RGBA (w x h) -> { gray: Uint8Array (nw x nh), w: nw, h: nh, scale } sẵn sàng cho Tesseract.
   * scale = nw / w: tọa độ OCR trả về chia cho scale là ra tọa độ ảnh gốc.
   */
  function prepare(rgba, w, h, options) {
    var o = opts(options);
    var g = toGray(rgba, w, h);
    var s = chooseScale(w, h, o);
    var nw = w;
    var nh = h;
    if (Math.abs(s - 1) > 0.02) {
      nw = Math.max(1, Math.round(w * s));
      nh = Math.max(1, Math.round(h * s));
      g = s > 1 ? resizeUp(g, w, h, nw, nh) : resizeDown(g, w, h, nw, nh);
    }
    flatten(g, nw, nh, o);
    return { gray: g, w: nw, h: nh, scale: nw / w };
  }

  return { DEFAULTS: DEFAULTS, chooseScale: chooseScale, toGray: toGray, flatten: flatten, prepare: prepare };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OcrPrep;
