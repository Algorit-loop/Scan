/**
 * Làm rõ chữ cho ảnh tài liệu đã nắn phẳng (chế độ "Rõ chữ"): giấy trắng đều, chữ đậm, nét hơn.
 *
 *  1. Ước lượng nền giấy (độ sáng + màu ánh đèn) cho từng kênh màu trên ảnh thu nhỏ: lọc MAX xóa nét chữ tối,
 *     rồi làm mờ -> bản đồ nền trơn, đi theo bóng đổ / ánh sáng không đều.
 *  2. Chia từng điểm ảnh cho nền tại chỗ đó: bóng và ám màu biến mất, giấy thành trắng.
 *  3. Tăng nét (unsharp mask) rồi kéo mức: điểm đen lấy theo phân vị tối của ảnh, gamma > 1 làm chữ đậm lên trong
 *     khi trắng vẫn là trắng.
 *
 * Hình ảnh / ảnh chụp nằm trong trang cũng bị làm sáng theo nên có thể bạc màu — vì vậy app giữ cả ảnh gốc để chọn.
 * Thuần JS, không phụ thuộc gì: chạy trong Worker của trang quét (sau khi nắn phẳng) và trong Node để test.
 */
var Enhance = (function () {
  var DEFAULTS = {
    small: 320, // cạnh dài ảnh thu nhỏ dùng ước lượng nền
    dilate: 3, // bán kính lọc MAX (px ảnh nhỏ): phải lớn hơn bề dày nét chữ
    blur: 8, // bán kính làm mờ nền (px ảnh nhỏ)
    minBackground: 48, // nền tối hơn mức này (0..255) không được coi là giấy: tránh khuếch đại nhiễu vùng đen
    white: 0.94, // giấy sáng >= mức này so với nền thì thành trắng hẳn
    blackPercentile: 0.02, // phân vị độ sáng lấy làm điểm đen
    maxBlack: 110, // điểm đen không vượt mức này (ảnh ít chữ: đừng kéo nền thành xám)
    gamma: 1.25,
    sharpen: 0.6,
  };

  function opts(o) {
    var r = {};
    for (var k in DEFAULTS) r[k] = o && o[k] != null ? o[k] : DEFAULTS[k];
    return r;
  }

  /** Lọc MAX rồi (tùy chọn) trung bình trượt, tách hai trục, trên ảnh float w x h. */
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

  /** Bản đồ nền 3 kênh trên lưới sw x sh. */
  function background(rgba, w, h, o) {
    var k = Math.min(1, o.small / Math.max(w, h));
    var sw = Math.max(1, Math.round(w * k));
    var sh = Math.max(1, Math.round(h * k));
    var sum = [new Float32Array(sw * sh), new Float32Array(sw * sh), new Float32Array(sw * sh)];
    var cnt = new Float32Array(sw * sh);
    var xs = new Int32Array(w);
    for (var x = 0; x < w; x++) xs[x] = Math.min(sw - 1, Math.floor((x * sw) / w));
    for (var y = 0; y < h; y++) {
      var row = Math.min(sh - 1, Math.floor((y * sh) / h)) * sw;
      var p = y * w * 4;
      for (var x2 = 0; x2 < w; x2++, p += 4) {
        var i = row + xs[x2];
        sum[0][i] += rgba[p];
        sum[1][i] += rgba[p + 1];
        sum[2][i] += rgba[p + 2];
        cnt[i]++;
      }
    }
    var maps = [];
    for (var c = 0; c < 3; c++) {
      for (var j = 0; j < sw * sh; j++) sum[c][j] /= cnt[j] || 1;
      var bg = boxBlur(boxBlur(maxFilter(sum[c], sw, sh, o.dilate), sw, sh, o.blur), sw, sh, o.blur);
      for (var j2 = 0; j2 < sw * sh; j2++) if (bg[j2] < o.minBackground) bg[j2] = o.minBackground;
      maps.push(bg);
    }
    return { maps: maps, sw: sw, sh: sh };
  }

  /**
   * RGBA (Uint8Array / Uint8ClampedArray, w x h) -> Uint8ClampedArray RGBA mới đã làm rõ chữ (alpha = 255).
   */
  function documentEnhance(rgba, w, h, options) {
    var o = opts(options);
    var b = background(rgba, w, h, o);
    var sw = b.sw;
    var sh = b.sh;
    var n = w * h;
    var norm = new Uint8ClampedArray(n * 4);
    var hist = new Uint32Array(256);
    var gainK = 255 / o.white;

    // Bước 2: chia cho nền (nội suy song tuyến tính bản đồ nền lên cỡ ảnh).
    var x0 = new Int32Array(w);
    var fx = new Float32Array(w);
    for (var x = 0; x < w; x++) {
      var gx = ((x + 0.5) * sw) / w - 0.5;
      if (gx < 0) gx = 0;
      var ix = Math.min(sw - 1, Math.floor(gx));
      x0[x] = ix;
      fx[x] = ix >= sw - 1 ? 0 : gx - ix;
    }
    for (var y = 0; y < h; y++) {
      var gy = ((y + 0.5) * sh) / h - 0.5;
      if (gy < 0) gy = 0;
      var iy = Math.min(sh - 1, Math.floor(gy));
      var fy = iy >= sh - 1 ? 0 : gy - iy;
      var r0 = iy * sw;
      var r1 = Math.min(sh - 1, iy + 1) * sw;
      var p = y * w * 4;
      for (var x2 = 0; x2 < w; x2++, p += 4) {
        var a = x0[x2];
        var a1 = Math.min(sw - 1, a + 1);
        var t = fx[x2];
        var lum = 0;
        for (var c = 0; c < 3; c++) {
          var m = b.maps[c];
          var top = m[r0 + a] + (m[r0 + a1] - m[r0 + a]) * t;
          var bot = m[r1 + a] + (m[r1 + a1] - m[r1 + a]) * t;
          var v = (rgba[p + c] * gainK) / (top + (bot - top) * fy);
          if (v > 255) v = 255;
          norm[p + c] = v;
          lum += v;
        }
        norm[p + 3] = 255;
        hist[Math.round(lum / 3)]++;
      }
    }

    // Điểm đen theo phân vị -> bảng tra kéo mức + gamma.
    var target = n * o.blackPercentile;
    var acc = 0;
    var black = 0;
    for (var i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) {
        black = i;
        break;
      }
    }
    if (black > o.maxBlack) black = o.maxBlack;
    var lut = new Uint8ClampedArray(256);
    for (var q = 0; q < 256; q++) {
      var u = (q - black) / (255 - black);
      lut[q] = u <= 0 ? 0 : Math.pow(u, o.gamma) * 255;
    }

    // Bước 3: unsharp mask (nhân [1 2 1]/4 hai trục) rồi tra bảng.
    var out = new Uint8ClampedArray(n * 4);
    var amount = o.sharpen;
    var rowBytes = w * 4;
    for (var yy = 0; yy < h; yy++) {
      var up = (yy > 0 ? yy - 1 : yy) * rowBytes;
      var mid = yy * rowBytes;
      var dn = (yy < h - 1 ? yy + 1 : yy) * rowBytes;
      for (var xx = 0; xx < w; xx++) {
        var l = (xx > 0 ? xx - 1 : xx) * 4;
        var ce = xx * 4;
        var rr = (xx < w - 1 ? xx + 1 : xx) * 4;
        for (var ch = 0; ch < 3; ch++) {
          var blur =
            (norm[up + l + ch] + 2 * norm[up + ce + ch] + norm[up + rr + ch] +
              2 * (norm[mid + l + ch] + 2 * norm[mid + ce + ch] + norm[mid + rr + ch]) +
              norm[dn + l + ch] + 2 * norm[dn + ce + ch] + norm[dn + rr + ch]) / 16;
          var s = norm[mid + ce + ch];
          var sv = Math.round(s + amount * (s - blur));
          out[mid + ce + ch] = lut[sv < 0 ? 0 : sv > 255 ? 255 : sv];
        }
        out[mid + ce + 3] = 255;
      }
    }
    return out;
  }

  return { DEFAULTS: DEFAULTS, documentEnhance: documentEnhance };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Enhance;
