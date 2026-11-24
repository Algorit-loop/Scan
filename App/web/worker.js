/**
 * Web Worker chạy docdetect_v3 (WebAssembly). Mã engine (createDocDetect) được ghép phía trước file này.
 *
 * Nhận:  { type: 'detect',  id, w, h, buffer }              buffer: RGBA của khung nhỏ
 *        { type: 'capture', id, w, h, buffer, hint, maxSide } buffer: RGBA độ phân giải gốc; hint: 8 số chuẩn hóa | null
 * Gửi:   { type: 'ready' } | { type: 'fatal', message }
 *        { type: 'detect', id, result } | { type: 'capture', id, w, h, buffer, enhanced, flattened, corners }
 *        (enhanced: RGBA bản "Rõ chữ" cùng cỡ, hoặc null)
 *        { type: <loại>, id, error }
 */
/* global createDocDetect, Enhance */
var mod = null;
var loading = null;
var outPtr = 0;
var bufPtr = 0;
var bufSize = 0;
var RESULT_SIZE = 15;
// Kết quả detect lúc chụp có góc lệch khung đang theo dõi quá mức này thì tin khung theo dõi hơn
// (khung theo dõi đã được lọc qua nhiều lần detect; ứng viên sai thường chỉ lệch 1-2 góc).
var CAPTURE_AGREE = 0.04;

function load() {
  if (!loading) {
    loading = createDocDetect().then(function (m) {
      mod = m;
      outPtr = m._malloc(RESULT_SIZE * 4);
      bufPtr = 0;
      bufSize = 0;
    });
    loading.catch(function () {
      loading = null;
    });
  }
  return loading;
}

function reset() {
  // Lỗi bên trong wasm (vd. abort) làm module hỏng: bỏ đi, lần sau nạp lại.
  mod = null;
  loading = null;
}

function upload(bytes) {
  if (bytes.length > bufSize) {
    if (bufPtr) mod._free(bufPtr);
    bufPtr = mod._malloc(bytes.length);
    bufSize = bytes.length;
  }
  mod.HEAPU8.set(bytes, bufPtr);
  return bufPtr;
}

function detect(bytes, w, h) {
  var p = upload(bytes);
  var status = mod._scan_detect(p, w, h, outPtr);
  var o = mod.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + RESULT_SIZE);
  return {
    status: status,
    found: o[0] === 1,
    reason: o[1],
    confidence: o[2],
    corners: Array.prototype.slice.call(o, 3, 11),
    area: o[11],
    sharpness: o[12],
    ms: o[13],
    score: o[14],
  };
}

function maxDist(a, b) {
  var m = 0;
  for (var i = 0; i < 8; i += 2) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
  return m;
}

function capture(bytes, w, h, hint, maxSide) {
  var r = detect(bytes, w, h);
  var q = null;
  if (r.found && (!hint || maxDist(r.corners, hint) < CAPTURE_AGREE)) q = r.corners;
  else if (hint) q = hint;
  else if (r.found) q = r.corners;
  if (!q) return { w: w, h: h, bytes: bytes, flattened: false, corners: null };

  var px = new Float32Array(8);
  for (var i = 0; i < 8; i += 2) {
    px[i] = q[i] * w;
    px[i + 1] = q[i + 1] * h;
  }
  var top = Math.hypot(px[2] - px[0], px[3] - px[1]);
  var bottom = Math.hypot(px[4] - px[6], px[5] - px[7]);
  var left = Math.hypot(px[6] - px[0], px[7] - px[1]);
  var right = Math.hypot(px[4] - px[2], px[5] - px[3]);
  var ow = Math.max(top, bottom);
  var oh = Math.max(left, right);
  var k = Math.min(1, maxSide / Math.max(ow, oh));
  ow = Math.max(1, Math.round(ow * k));
  oh = Math.max(1, Math.round(oh * k));

  var cornersPtr = mod._malloc(32);
  var dstPtr = mod._malloc(ow * oh * 4);
  try {
    mod.HEAPF32.set(px, cornersPtr >> 2);
    // detect() vừa chép ảnh vào bufPtr; malloc thêm có thể nới bộ nhớ nhưng không dời con trỏ cũ.
    if (mod._scan_warp(bufPtr, w, h, cornersPtr, ow, oh, dstPtr) !== 0) throw new Error('scan_warp thất bại');
    var out = new Uint8ClampedArray(ow * oh * 4);
    out.set(mod.HEAPU8.subarray(dstPtr, dstPtr + ow * oh * 4));
    // Bản "Rõ chữ" (web/enhance.js, ghép trước file này khi build; trang /video của Core không có nên bỏ qua).
    var enhanced = typeof Enhance !== 'undefined' ? Enhance.documentEnhance(out, ow, oh) : null;
    return { w: ow, h: oh, bytes: out, enhanced: enhanced, flattened: true, corners: q };
  } finally {
    mod._free(cornersPtr);
    mod._free(dstPtr);
  }
}

self.onmessage = function (e) {
  var msg = e.data;
  load()
    .then(function () {
      var bytes = new Uint8Array(msg.buffer);
      if (msg.type === 'detect') {
        self.postMessage({ type: 'detect', id: msg.id, result: detect(bytes, msg.w, msg.h) });
      } else if (msg.type === 'capture') {
        var c = capture(bytes, msg.w, msg.h, msg.hint, msg.maxSide);
        var buf = c.bytes.buffer;
        var enh = c.enhanced ? c.enhanced.buffer : null;
        self.postMessage(
          { type: 'capture', id: msg.id, w: c.w, h: c.h, buffer: buf, enhanced: enh, flattened: c.flattened, corners: c.corners },
          enh ? [buf, enh] : [buf],
        );
      }
    })
    .catch(function (err) {
      reset();
      self.postMessage({ type: msg.type, id: msg.id, error: String((err && err.message) || err) });
    });
};

load().then(
  function () {
    self.postMessage({ type: 'ready' });
  },
  function (err) {
    self.postMessage({ type: 'fatal', message: String((err && err.message) || err) });
  },
);
