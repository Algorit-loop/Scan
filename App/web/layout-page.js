/**
 * Trang ẩn (WebView) phân vùng bố cục. App ghi trang ra file trong cache và mở bằng file://; onnxruntime wasm, các
 * model và ảnh là file trong máy, trang tự đọc bằng XHR (ASSETS = { ort, ori, S, L }: đường dẫn file://).
 * Qua cầu nối React Native <-> WebView chỉ có message nhỏ (trước đây đẩy ~60 MB base64 làm treo app).
 *
 * Phần nặng chạy trong Web Worker (web/layout-worker.js) để luồng chính không bị chặn — trên Android các WebView
 * của app dùng chung tiến trình render, chặn luồng chính ở đây là đứng cả WebView camera.
 * Luồng chính chỉ: đọc file, giải mã JPEG ra RGBA, mã hóa lại JPEG nếu trang đã được xoay.
 *
 * app -> trang: window.__rn({ type: 'preload', models })               models: ['S' | 'L']
 *               window.__rn({ type: 'analyze', id, uri, model, noImage? })   uri: file:// của ảnh JPEG; noImage: không
 *                                                                       cần trả ảnh đã xoay (app tự xoay file)
 * trang -> app: { type: 'loaded' } | { type: 'warn', message }
 *               { type: 'visibility', id, state }      'hidden': iOS coi WebView không hiển thị, việc dài sẽ bị đóng băng
 *               { type: 'session', name, ms } | { type: 'sessionError', name, message }   name: 'ori' | 'S' | 'L'
 *               { type: 'layout', id, model, width, height, rotate, orientation, image?, regions, ms }
 *               { type: 'layoutError', id, message }
 */
/* global ASSETS, WORKER_SRC */
(function () {
  var JPEG_QUALITY = 0.92;
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  var decodeMs = {}; // id -> ms giải mã (cộng vào kết quả)

  function send(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function errText(e) {
    return (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
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
    worker = new Worker(url, { type: 'module' });
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
          // Báo cả worker (đang chờ file này) để nó báo lỗi thay vì chờ mãi; worker sẽ gửi sessionError cho app.
          worker.postMessage({ type: 'assetError', name: m.name, message: err && err.message ? err.message : String(err) });
        },
      );
    } else if (m.type === 'layout') {
      m.ms.decode = decodeMs[m.id] || 0;
      m.ms.total += m.ms.decode;
      delete decodeMs[m.id];
      if (m.rgba) {
        m.image = toJpeg(new Uint8ClampedArray(m.rgba), m.width, m.height);
        delete m.rgba;
      }
      send(m);
    } else {
      if (m.type === 'layoutError') delete decodeMs[m.id];
      send(m);
    }
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

  function toJpeg(data, w, h) {
    canvas.width = w;
    canvas.height = h;
    ctx.putImageData(new ImageData(data, w, h), 0, 0);
    var url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    canvas.width = canvas.height = 1;
    return url.slice(url.indexOf(',') + 1);
  }

  function reportVisibility(id) {
    send({ type: 'visibility', id: id, state: document.visibilityState });
  }
  document.addEventListener('visibilitychange', function () {
    reportVisibility(0);
  });

  window.__rn = function (msg) {
    if (!msg) return;
    if (msg.type === 'analyze') reportVisibility(msg.id);
    if (msg.type === 'preload') {
      worker.postMessage({ type: 'preload', models: msg.models || [] });
    } else if (msg.type === 'analyze') {
      var t0 = performance.now();
      decode(msg.uri).then(
        function (img) {
          decodeMs[msg.id] = performance.now() - t0;
          worker.postMessage(
            { type: 'analyze', id: msg.id, model: msg.model, noImage: !!msg.noImage, w: img.w, h: img.h, rgba: img.data.buffer },
            [img.data.buffer],
          );
        },
        function (e) {
          send({ type: 'layoutError', id: msg.id, message: errText(e) });
        },
      );
    }
  };

  send({ type: 'loaded' });
})();
