/**
 * Web Worker nhận dạng chữ (OCR): tiền xử lý (web/ocr-prep.js) -> Tesseract (WebAssembly, LSTM, tiếng Việt) -> danh sách
 * dòng chữ có tọa độ (web/ocr-parse.js). Chạy trong worker để luồng chính của WebView không bị chặn.
 * build-web.mjs ghép trước file này: tesseract.js-core (biến `TesseractCore`), ocr-prep.js (`OcrPrep`), ocr-parse.js
 * (`OcrParse`).
 *
 * Nhận:  { type: 'asset', name, bytes }            name: 'core' (wasm) | 'vie' (traineddata); bytes: ArrayBuffer
 *        { type: 'assetError', name, message }     trang không đọc được file -> báo lỗi thay vì chờ mãi
 *        { type: 'preload' }
 *        { type: 'ocr', id, w, h, rgba }            rgba: ArrayBuffer ảnh đã dựng thẳng
 * Gửi:   { type: 'need', name }                    xin asset còn thiếu (trang đọc file rồi gửi 'asset')
 *        { type: 'ready', ms } | { type: 'engineError', message }
 *        { type: 'stage', id, stage }               đang ở bước nào (log trên máy thật)
 *        { type: 'text', id, width, height, ocrSize, lines, conf, ms }   lines: xem ocr-parse.js; tọa độ theo ảnh vào
 *        { type: 'ocrError', id, message }
 */
/* global TesseractCore, OcrPrep, OcrParse */
var LANG = 'vie';
var waiters = {}; // name -> { promise, resolve, reject }
var engine = null; // Promise<{ T, api }>
var chain = Promise.resolve();

function errText(e) {
  return (e && e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
}

function asset(name) {
  if (!waiters[name]) {
    var w = {};
    w.promise = new Promise(function (res, rej) {
      w.resolve = res;
      w.reject = rej;
    });
    waiters[name] = w;
    self.postMessage({ type: 'need', name: name });
  }
  return waiters[name].promise;
}

function ensureEngine() {
  if (!engine) {
    var t0 = performance.now();
    engine = Promise.all([asset('core'), asset(LANG)]).then(function (r) {
      return TesseractCore({ wasmBinary: new Uint8Array(r[0]) }).then(function (T) {
        T.FS.writeFile('/' + LANG + '.traineddata', new Uint8Array(r[1]));
        var api = new T.TessBaseAPI();
        if (api.Init('/', LANG, T.OEM_LSTM_ONLY) !== 0) throw new Error('Không khởi tạo được Tesseract (' + LANG + ')');
        // Tự phân tích bố cục trang: khối -> đoạn -> dòng, đọc đúng thứ tự cột.
        api.SetPageSegMode(T.PSM_AUTO);
        delete waiters.core; // bytes không cần nữa (module giữ bản riêng)
        delete waiters[LANG];
        self.postMessage({ type: 'ready', ms: performance.now() - t0 });
        return { T: T, api: api };
      });
    });
    engine.catch(function (e) {
      engine = null;
      waiters = {};
      self.postMessage({ type: 'engineError', message: errText(e) });
    });
  }
  return engine;
}

function recognize(msg) {
  var t0 = performance.now();
  var ms = {};
  function stage(name) {
    self.postMessage({ type: 'stage', id: msg.id, stage: name });
  }
  stage('chờ bộ nhận dạng');
  return ensureEngine()
    .then(function (e) {
      ms.load = performance.now() - t0;
      var t1 = performance.now();
      stage('tiền xử lý ảnh');
      var pre = OcrPrep.prepare(new Uint8ClampedArray(msg.rgba), msg.w, msg.h);
      ms.pre = performance.now() - t1;
      var t2 = performance.now();
      stage('nhận dạng chữ ' + pre.w + 'x' + pre.h);
      var ptr = e.T._malloc(pre.gray.length);
      var lines;
      try {
        e.T.HEAPU8.set(pre.gray, ptr);
        e.api.SetImage(ptr, pre.w, pre.h, 1, pre.w);
        e.api.SetSourceResolution(300); // ảnh đã đổi cỡ về cỡ chữ quét 300 dpi; tránh Tesseract tự đoán
        if (e.api.Recognize(null) !== 0) throw new Error('Tesseract không nhận dạng được ảnh');
        lines = OcrParse.parseTsv(e.api.GetTSVText(0), pre.scale);
      } finally {
        e.api.Clear();
        e.T._free(ptr);
      }
      ms.ocr = performance.now() - t2;
      ms.total = performance.now() - t1;
      var n = 0;
      var sum = 0;
      lines.forEach(function (l) {
        l.words.forEach(function (w) {
          n++;
          sum += w.conf;
        });
      });
      self.postMessage({
        type: 'text',
        id: msg.id,
        width: msg.w,
        height: msg.h,
        ocrSize: [pre.w, pre.h],
        lines: lines,
        conf: n ? sum / n : 0,
        ms: ms,
      });
    })
    .catch(function (e) {
      self.postMessage({ type: 'ocrError', id: msg.id, message: errText(e) });
    });
}

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type === 'asset') {
    var w = waiters[msg.name];
    if (w) w.resolve(msg.bytes);
  } else if (msg.type === 'assetError') {
    var we = waiters[msg.name];
    delete waiters[msg.name];
    if (we) we.reject(new Error(msg.message));
  } else if (msg.type === 'preload') {
    ensureEngine().catch(function () {});
  } else if (msg.type === 'ocr') {
    chain = chain.then(function () {
      return recognize(msg);
    });
  }
};
