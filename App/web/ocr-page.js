/**
 * Trang ẩn (WebView) nhận dạng chữ. App ghi trang ra file trong cache và mở bằng file://; Tesseract wasm, dữ liệu
 * tiếng Việt và ảnh là file trong máy, trang tự đọc bằng XHR (ASSETS = { core, vie }: đường dẫn file://).
 * Phần nặng chạy trong Web Worker (web/ocr-worker.js). Luồng chính chỉ: đọc file, giải mã JPEG ra RGBA.
 *
 * app -> trang: window.__rn({ type: 'preload' })
 *               window.__rn({ type: 'ocr', id, uri })        uri: file:// của ảnh JPEG đã dựng thẳng
 * trang -> app: { type: 'loaded' } | { type: 'warn', message }
 *               { type: 'ready', ms } | { type: 'engineError', message }
 *               { type: 'stage', id, stage }
 *               { type: 'visibility', id, state }      'hidden': iOS coi WebView không hiển thị, việc dài sẽ bị đóng băng
 *               { type: 'text', id, width, height, ocrSize, lines, conf, ms } | { type: 'ocrError', id, message }
 */
/* global ASSETS, WORKER_SRC */
(function () {
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var decodeMs = {}; // id -> ms giải mã (cộng vào kết quả)

  function send(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function errText(e) {
    return e && e.message ? e.message : String(e);
  }

  /** Đọc file (file://) thành ArrayBuffer. fetch() không đọc được file:// nên dùng XHR (status 0 là thành công). */
  function readBytes(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.response && (xhr.status === 0 || xhr.status === 200)) resolve(xhr.response);
        else reject(new Error('Không đọc được ' + url + ' (' + xhr.status + ')'));
      };
      xhr.onerror = function () {
        reject(new Error('Không đọc được ' + url));
      };
      xhr.send();
    });
  }

  var worker;
  try {
    var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    WORKER_SRC = null;
    worker = new Worker(url);
  } catch (e) {
    send({ type: 'warn', message: 'Không tạo được Worker: ' + errText(e) });
    return;
  }
  worker.onerror = function (e) {
    send({ type: 'warn', message: 'Worker lỗi: ' + (e.message || 'không rõ') });
  };

  worker.onmessage = function (e) {
    var m = e.data;
    if (m.type === 'need') {
      readBytes(ASSETS[m.name]).then(
        function (bytes) {
          worker.postMessage({ type: 'asset', name: m.name, bytes: bytes }, [bytes]);
        },
        function (err) {
          // Báo worker (đang chờ file này) để nó báo lỗi thay vì chờ mãi.
          worker.postMessage({ type: 'assetError', name: m.name, message: errText(err) });
        },
      );
      return;
    }
    if (m.type === 'text') {
      m.ms.decode = decodeMs[m.id] || 0;
      m.ms.total += m.ms.decode;
    }
    if (m.type === 'text' || m.type === 'ocrError') delete decodeMs[m.id];
    send(m);
  };

  function decode(uri) {
    return readBytes(uri)
      .then(function (buf) {
        return createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
      })
      .then(function (bmp) {
        var w = bmp.width;
        var h = bmp.height;
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
        var data = ctx.getImageData(0, 0, w, h).data;
        canvas.width = canvas.height = 1;
        return { data: data, w: w, h: h };
      });
  }

  function reportVisibility(id) {
    send({ type: 'visibility', id: id, state: document.visibilityState });
  }
  document.addEventListener('visibilitychange', function () {
    reportVisibility(0);
  });

  window.__rn = function (msg) {
    if (!msg) return;
    if (msg.type === 'ocr') reportVisibility(msg.id);
    if (msg.type === 'preload') {
      worker.postMessage({ type: 'preload' });
    } else if (msg.type === 'ocr') {
      var t0 = performance.now();
      decode(msg.uri).then(
        function (img) {
          decodeMs[msg.id] = performance.now() - t0;
          worker.postMessage({ type: 'ocr', id: msg.id, w: img.w, h: img.h, rgba: img.data.buffer }, [img.data.buffer]);
        },
        function (e) {
          send({ type: 'ocrError', id: msg.id, message: errText(e) });
        },
      );
    }
  };

  send({ type: 'loaded' });
})();
