/**
 * Phân vùng bố cục trên ảnh đã nắn phẳng: (Hướng trang) -> Preprocessing -> Inference -> Post-processing.
 * File này chỉ có phần thuần JS (test được bằng Jest / Node); inference do onnxruntime-web chạy
 * (web/layout-page.js trong WebView, scripts/check-layout.mjs trên máy tính).
 *
 * Hai model bố cục (chọn trên app), cùng bộ 23 lớp, cùng hậu xử lý kiểu PaddleX:
 *  - S  PP-DocLayout-S (PicoDet/GFL): 480x480, chuẩn hóa ImageNet; NMS theo lớp (>= 0.3) nằm trong graph.
 *  - L  PP-DocLayout-L (RT-DETR-L, tính fp32, trọng số lưu fp16, bản chuẩn của dòng PP-DocLayout): 640x640, chỉ chia 255; thêm input
 *       im_shape; luôn ra 300 dòng.
 * Cả hai: resize bicubic KHÔNG giữ tỉ lệ (như cv2.INTER_CUBIC, làm tròn uint8), CHW, scale_factor = [side/h, side/w]
 * để model trả tọa độ theo ảnh gốc. Đầu ra [N, 6] = [lớp, điểm, x1, y1, x2, y2].
 * Hậu xử lý (DetPostProcess của PaddleX): lọc điểm > ngưỡng, layout_nms (cùng lớp IoU 0.6, khác lớp 0.98), bỏ khung
 * "image" phủ gần hết trang, cắt vào ảnh. Thêm: thứ tự đọc và tọa độ chuẩn hóa 0..1.
 *
 * Hướng trang: PP-LCNet_x1_0_doc_ori. Resize cạnh ngắn về 256 (bilinear), cắt giữa 224x224, chuẩn hóa ImageNet.
 * Nhãn = góc ảnh đang bị xoay THEO chiều kim đồng hồ (0/90/180/270) -> xoay thêm (360 - nhãn) theo chiều kim
 * đồng hồ để dựng thẳng. Chỉ xoay khi điểm >= ORI.minScore (ảnh mờ dễ đoán sai).
 */
var Layout = (function () {
  var IMAGENET = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };

  var MODELS = {
    S: {
      id: 'S',
      name: 'PP-DocLayout-S',
      side: 480,
      mean: IMAGENET.mean,
      std: IMAGENET.std,
      imShape: false,
      labels: [
        'paragraph_title', 'image', 'text', 'number', 'abstract', 'content', 'figure_title', 'formula', 'table',
        'table_title', 'reference', 'doc_title', 'footnote', 'header', 'algorithm', 'footer', 'seal', 'chart_title',
        'chart', 'formula_number', 'header_image', 'footer_image', 'aside_text',
      ],
    },
    L: {
      id: 'L',
      name: 'PP-DocLayout-L',
      side: 640,
      mean: [0, 0, 0],
      std: [1, 1, 1],
      imShape: true,
      labels: null, // cùng 23 lớp với S (gán bên dưới)
    },
  };

  MODELS.L.labels = MODELS.S.labels;

  var ORI = { side: 224, short: 256, angles: [0, 90, 180, 270], minScore: 0.6, mean: IMAGENET.mean, std: IMAGENET.std };

  var POST = {
    // Sàn điểm: S đã lọc 0.3 trong graph; màn kết quả lọc tiếp theo ngưỡng người dùng chọn. Lọc 0.5 sau layout_nms
    // ở 0.3 cho cùng kết quả như PaddleX lọc 0.5 trước (khung >= 0.5 chỉ bị khung điểm cao hơn loại).
    minScore: 0.3,
    layoutNms: true,
    iouSame: 0.6,
    iouDiff: 0.98,
    // Khung "image" phủ quá tỉ lệ này của trang là nhận nhầm cả trang (PaddleX: ảnh ngang 0.82, dọc 0.93).
    imageAreaLandscape: 0.82,
    imageAreaPortrait: 0.93,
  };

  function pick(o, defaults) {
    var r = {};
    for (var k in defaults) r[k] = o && o[k] != null ? o[k] : defaults[k];
    return r;
  }

  // ---------- Resample (resize + chuẩn hóa + CHW) ----------

  /** Hệ số bicubic của OpenCV (A = -0.75) cho phần lẻ t. */
  function cubicCoeffs(t, out) {
    var A = -0.75;
    var x0 = t + 1;
    var x1 = t;
    var x2 = 1 - t;
    out[0] = ((A * x0 - 5 * A) * x0 + 8 * A) * x0 - 4 * A;
    out[1] = ((A + 2) * x1 - (A + 3)) * x1 * x1 + 1;
    out[2] = ((A + 2) * x2 - (A + 3)) * x2 * x2 + 1;
    out[3] = 1 - out[0] - out[1] - out[2];
  }

  /**
   * Bảng chỉ số + trọng số (4 nhịp) cho một trục: điểm đích d (từ off tới off + n) của ảnh resize cỡ dst lấy từ
   * nguồn cỡ src theo tâm điểm ảnh như cv2.resize; chỉ số kẹp trong ảnh. kernel: 'cubic' | 'linear'.
   */
  function axisTable(src, dst, off, n, kernel) {
    var scale = src / dst;
    var idx = new Int32Array(n * 4);
    var wt = new Float32Array(n * 4);
    var c = [0, 0, 0, 0];
    for (var i = 0; i < n; i++) {
      var f = (off + i + 0.5) * scale - 0.5;
      if (kernel === 'linear') {
        if (f < 0) f = 0;
        var s0 = Math.floor(f);
        var t = f - s0;
        c[0] = 0;
        c[1] = 1 - t;
        c[2] = t;
        c[3] = 0;
        for (var k = 0; k < 4; k++) idx[i * 4 + k] = Math.min(src - 1, Math.max(0, s0 - 1 + k));
      } else {
        var s = Math.floor(f);
        cubicCoeffs(f - s, c);
        for (var k2 = 0; k2 < 4; k2++) idx[i * 4 + k2] = Math.min(src - 1, Math.max(0, s - 1 + k2));
      }
      for (var k3 = 0; k3 < 4; k3++) wt[i * 4 + k3] = c[k3];
    }
    return { idx: idx, wt: wt };
  }

  function clamp255(v) {
    v = Math.round(v);
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  /**
   * RGBA (w x h) -> Float32Array 3 x outH x outW (CHW, RGB): resize về rw x rh (tách hai trục như cv2, kết quả làm
   * tròn uint8), lấy vùng [offX, offX+outW) x [offY, offY+outH), chia 255, (v - mean) / std.
   */
  function resample(rgba, w, h, rw, rh, offX, offY, outW, outH, kernel, mean, std) {
    var tx = axisTable(w, rw, offX, outW, kernel);
    var ty = axisTable(h, rh, offY, outH, kernel);
    var mid = new Float32Array(h * outW * 3);
    for (var y = 0; y < h; y++) {
      var row = y * w * 4;
      for (var x = 0; x < outW; x++) {
        var r = 0;
        var g = 0;
        var b = 0;
        for (var k = 0; k < 4; k++) {
          var wk = tx.wt[x * 4 + k];
          if (wk === 0) continue;
          var p = row + tx.idx[x * 4 + k] * 4;
          r += rgba[p] * wk;
          g += rgba[p + 1] * wk;
          b += rgba[p + 2] * wk;
        }
        var m = (y * outW + x) * 3;
        mid[m] = r;
        mid[m + 1] = g;
        mid[m + 2] = b;
      }
    }
    var plane = outW * outH;
    var data = new Float32Array(3 * plane);
    var a0 = 1 / (255 * std[0]);
    var a1 = 1 / (255 * std[1]);
    var a2 = 1 / (255 * std[2]);
    var b0 = -mean[0] / std[0];
    var b1 = -mean[1] / std[1];
    var b2 = -mean[2] / std[2];
    for (var yy = 0; yy < outH; yy++) {
      for (var xx = 0; xx < outW; xx++) {
        var R = 0;
        var G = 0;
        var B = 0;
        for (var j = 0; j < 4; j++) {
          var wj = ty.wt[yy * 4 + j];
          if (wj === 0) continue;
          var q = (ty.idx[yy * 4 + j] * outW + xx) * 3;
          R += mid[q] * wj;
          G += mid[q + 1] * wj;
          B += mid[q + 2] * wj;
        }
        var o = yy * outW + xx;
        data[o] = clamp255(R) * a0 + b0;
        data[plane + o] = clamp255(G) * a1 + b1;
        data[2 * plane + o] = clamp255(B) * a2 + b2;
      }
    }
    return data;
  }

  /**
   * Tiền xử lý cho model bố cục. options: { model: 'S' | 'L' } hoặc ghi đè { side, mean, std }.
   * Trả { data: CHW 1x3xSxS, scale: [S/h, S/w], side, imShape: bool }.
   */
  function preprocess(rgba, w, h, options) {
    var base = MODELS[(options && options.model) || 'S'];
    var o = pick(options, { side: base.side, mean: base.mean, std: base.std });
    var S = o.side;
    return {
      data: resample(rgba, w, h, S, S, 0, 0, S, S, 'cubic', o.mean, o.std),
      scale: new Float32Array([S / h, S / w]),
      side: S,
      imShape: base.imShape,
    };
  }

  // ---------- Hướng trang ----------

  /** Tiền xử lý doc_ori: cạnh ngắn -> 256 (bilinear, làm tròn như PaddleClas), cắt giữa 224x224, ImageNet. */
  function orientationPreprocess(rgba, w, h) {
    var p = ORI.short / Math.min(w, h);
    var rw = Math.round(w * p);
    var rh = Math.round(h * p);
    var x0 = Math.floor((rw - ORI.side) / 2);
    var y0 = Math.floor((rh - ORI.side) / 2);
    return resample(rgba, w, h, rw, rh, x0, y0, ORI.side, ORI.side, 'linear', ORI.mean, ORI.std);
  }

  /**
   * Từ đầu ra doc_ori (4 điểm) -> { angle: góc ảnh đang bị xoay theo chiều kim đồng hồ, score, rotate: số độ cần xoay
   * thêm theo chiều kim đồng hồ để dựng thẳng (0 nếu điểm thấp) }.
   */
  function orientation(scores) {
    var best = 0;
    for (var i = 1; i < 4; i++) if (scores[i] > scores[best]) best = i;
    var angle = ORI.angles[best];
    var score = scores[best];
    var rotate = score >= ORI.minScore ? (360 - angle) % 360 : 0;
    return { angle: angle, score: score, rotate: rotate };
  }

  /** Xoay ảnh RGBA theo chiều kim đồng hồ 0/90/180/270 độ. */
  function rotateRGBA(rgba, w, h, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (deg === 0) return { data: rgba, w: w, h: h };
    var nw = deg === 180 ? w : h;
    var nh = deg === 180 ? h : w;
    var src = new Uint32Array(rgba.buffer, rgba.byteOffset, w * h);
    var outBuf = new Uint8ClampedArray(w * h * 4);
    var dst = new Uint32Array(outBuf.buffer);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var nx;
        var ny;
        if (deg === 90) {
          nx = h - 1 - y;
          ny = x;
        } else if (deg === 180) {
          nx = w - 1 - x;
          ny = h - 1 - y;
        } else {
          nx = y;
          ny = w - 1 - x;
        }
        dst[ny * nw + nx] = src[y * w + x];
      }
    }
    return { data: outBuf, w: nw, h: nh };
  }

  // ---------- Post-processing ----------

  /** IoU kiểu PaddleX (cộng 1 điểm ảnh vào cạnh). */
  function iou(a, b) {
    var iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1);
    var ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1);
    var inter = iw * ih;
    var ua = (a[2] - a[0] + 1) * (a[3] - a[1] + 1) + (b[2] - b[0] + 1) * (b[3] - b[1] + 1) - inter;
    return inter / ua;
  }

  /** NMS hai ngưỡng: cùng lớp chồng >= iouSame hoặc khác lớp chồng >= iouDiff thì bỏ khung điểm thấp hơn. */
  function layoutNms(boxes, iouSame, iouDiff) {
    var order = boxes.slice().sort(function (a, b) {
      return b.score - a.score;
    });
    var keep = [];
    while (order.length) {
      var cur = order.shift();
      keep.push(cur);
      order = order.filter(function (bx) {
        return iou(cur.box, bx.box) < (bx.cls === cur.cls ? iouSame : iouDiff);
      });
    }
    return keep;
  }

  /**
   * Trên -> dưới theo dòng, trong dòng trái -> phải. Hai khung cùng dòng khi chồng dọc quá nửa chiều cao khung thấp
   * hơn VÀ cao cỡ nhau (không quá 3 lần): một khung rất cao (ảnh, bảng cả trang) không nuốt các khung nhỏ cạnh nó.
   */
  function readingOrder(boxes) {
    var sorted = boxes.slice().sort(function (a, b) {
      return a.box[1] - b.box[1] || a.box[0] - b.box[0];
    });
    var rows = [];
    sorted.forEach(function (bx) {
      var row = rows[rows.length - 1];
      if (row) {
        var a = row.items[0].box; // so với khung mở dòng, không nới dòng theo khung mới
        var b = bx.box;
        var ha = a[3] - a[1];
        var hb = b[3] - b[1];
        var overlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        if (overlap > 0.5 * Math.min(ha, hb) && Math.max(ha, hb) <= 3 * Math.min(ha, hb)) {
          row.items.push(bx);
          return;
        }
      }
      rows.push({ items: [bx] });
    });
    var out = [];
    rows.forEach(function (row) {
      row.items.sort(function (a, b) {
        return a.box[0] - b.box[0];
      });
      out.push.apply(out, row.items);
    });
    return out;
  }

  /**
   * dets: mảng phẳng N x 6 từ model; num: số dòng hợp lệ; w, h: kích thước ảnh đưa vào model.
   * options: { model: 'S' | 'L' } + ghi đè POST. Trả [{ index, cls, label, score, box (px), norm (0..1) }] theo
   * thứ tự đọc.
   */
  function postprocess(dets, num, w, h, options) {
    var labels = MODELS[(options && options.model) || 'S'].labels;
    var o = pick(options, POST);
    var boxes = [];
    for (var i = 0; i < num; i++) {
      var r = i * 6;
      var cls = Math.round(dets[r]);
      var score = dets[r + 1];
      if (cls > -1 && cls < labels.length && score > o.minScore) {
        boxes.push({ cls: cls, score: score, box: [dets[r + 2], dets[r + 3], dets[r + 4], dets[r + 5]] });
      }
    }
    if (o.layoutNms) boxes = layoutNms(boxes, o.iouSame, o.iouDiff);

    if (boxes.length > 1) {
      var imageCls = labels.indexOf('image');
      var limit = (w > h ? o.imageAreaLandscape : o.imageAreaPortrait) * w * h;
      var kept = boxes.filter(function (bx) {
        if (bx.cls !== imageCls) return true;
        var b = bx.box;
        var area = (Math.min(w, b[2]) - Math.max(0, b[0])) * (Math.min(h, b[3]) - Math.max(0, b[1]));
        return area <= limit;
      });
      if (kept.length) boxes = kept;
    }

    var out = [];
    boxes.forEach(function (bx) {
      var x1 = Math.max(0, bx.box[0]);
      var y1 = Math.max(0, bx.box[1]);
      var x2 = Math.min(w, bx.box[2]);
      var y2 = Math.min(h, bx.box[3]);
      if (x2 <= x1 || y2 <= y1) return;
      out.push({ cls: bx.cls, label: labels[bx.cls], score: bx.score, box: [x1, y1, x2, y2], norm: [x1 / w, y1 / h, x2 / w, y2 / h] });
    });
    return readingOrder(out).map(function (bx, i) {
      bx.index = i + 1;
      return bx;
    });
  }

  return {
    MODELS: MODELS,
    ORI: ORI,
    POST: POST,
    /** Nhãn của PP-DocLayout-S (giữ cho mã cũ). */
    LABELS: MODELS.S.labels,
    preprocess: preprocess,
    orientationPreprocess: orientationPreprocess,
    orientation: orientation,
    rotateRGBA: rotateRGBA,
    postprocess: postprocess,
    iou: iou,
    layoutNms: layoutNms,
    readingOrder: readingOrder,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
