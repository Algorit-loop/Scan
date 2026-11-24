/**
 * Web Worker (module) chạy phần nặng của phân vùng bố cục: hướng trang, tiền xử lý, onnxruntime, hậu xử lý.
 * Chạy trong worker để luồng chính của WebView không bị chặn: trên Android các WebView của app dùng chung một tiến
 * trình render, nên suy luận vài giây trên luồng chính làm đứng cả WebView camera (không chụp được).
 * build-web.mjs ghép trước file này: onnxruntime-web (biến `ort`) và web/layout.js (biến `Layout`).
 *
 * Nhận:  { type: 'asset', name, bytes }            name: 'ort' (wasm) | 'ori' | 'S' | 'L'; bytes: ArrayBuffer
 *        { type: 'assetError', name, message }     trang không đọc được file -> báo lỗi thay vì chờ mãi
 *        { type: 'preload', models }
 *        { type: 'analyze', id, model, w, h, rgba }  rgba: ArrayBuffer ảnh gốc
 * Gửi:   { type: 'env', ... }                     khả năng tăng tốc của WebView (in ra log để chọn hướng tối ưu)
 *        { type: 'need', name }                    xin asset còn thiếu (trang đọc file rồi gửi 'asset')
 *        { type: 'stage', id, stage }               đang ở bước nào (để log trên máy thật biết dừng ở đâu)
 *        { type: 'session', name, ms } | { type: 'sessionError', name, message }
 *        { type: 'layout', id, model, width, height, rotate, orientation, rgba?, regions, ms }
 *        { type: 'layoutError', id, message }
 */
/* global ort, Layout */
var assetWaiters = {}; // name -> { promise, resolve, reject }
var sessions = {}; // name -> Promise<InferenceSession>
var chain = Promise.resolve();

function errText(e) {
  return (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
}

function asset(name) {
  if (!assetWaiters[name]) {
    var w = {};
    w.promise = new Promise(function (res, rej) {
      w.resolve = res;
      w.reject = rej;
    });
    assetWaiters[name] = w;
    self.postMessage({ type: 'need', name: name });
  }
  return assetWaiters[name].promise;
}

var ortReady = null;
function ensureOrt() {
  if (!ortReady) {
    ortReady = asset('ort').then(function (wasm) {
      ort.env.wasm.wasmBinary = new Uint8Array(wasm);
      ort.env.wasm.numThreads = 1; // WebView không có SharedArrayBuffer (không cross-origin isolated)
      ort.env.wasm.proxy = false;
    });
    ortReady.catch(function () {
      ortReady = null;
      delete assetWaiters.ort;
    });
  }
  return ortReady;
}

// Tùy chọn session. L (RT-DETR, lớn, ~0,5 GB khi chạy): tắt arena + mem pattern của ORT để giảm bộ nhớ đỉnh trong
// WebView (iOS dừng cả WebView khi vượt hạn mức); trên máy tính tốc độ gần như không đổi.
function sessionOptions(name) {
  var o = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  if (name === 'L') {
    o.enableCpuMemArena = false;
    o.enableMemPattern = false;
  }
  return o;
}

/** Đầu vào cho model bố cục (data: CHW SxS float32). */
function layoutFeeds(model, data, scale) {
  var S = Layout.MODELS[model].side;
  var feeds = {
    image: new ort.Tensor('float32', data, [1, 3, S, S]),
    scale_factor: new ort.Tensor('float32', scale, [1, 2]),
  };
  if (Layout.MODELS[model].imShape) feeds.im_shape = new ort.Tensor('float32', new Float32Array([S, S]), [1, 2]);
  return feeds;
}

/** Session của 'ori' | 'S' | 'L' (CPU, wasm 1 luồng). */
function session(name) {
  if (!sessions[name]) {
    sessions[name] = Promise.all([ensureOrt(), asset(name)]).then(function (r) {
      var t0 = performance.now();
      return ort.InferenceSession.create(new Uint8Array(r[1]), sessionOptions(name)).then(
        function (s) {
          delete assetWaiters[name]; // bytes không cần nữa (session giữ bản riêng)
          self.postMessage({ type: 'session', name: name, ms: performance.now() - t0 });
          return s;
        },
      );
    });
    sessions[name].catch(function (e) {
      delete sessions[name];
      delete assetWaiters[name];
      self.postMessage({ type: 'sessionError', name: name, message: errText(e) });
    });
  }
  return sessions[name];
}

function analyze(msg) {
  var model = Layout.MODELS[msg.model] ? msg.model : 'S';
  var ms = {};
  var t0 = performance.now();
  var t = t0;
  function lap(key) {
    var now = performance.now();
    ms[key] = now - t;
    t = now;
  }
  function stage(name) {
    self.postMessage({ type: 'stage', id: msg.id, stage: name });
  }
  var img = { data: new Uint8ClampedArray(msg.rgba), w: msg.w, h: msg.h };
  stage('chờ model ' + model);
  var rot = { angle: 0, score: 0, rotate: 0 };
  var sess;
  return Promise.all([session('ori'), session(model)])
    .then(function (s) {
      sess = s[1];
      ms.load = performance.now() - t0;
      stage('hướng trang');
      t0 = t = performance.now();
      var x = Layout.orientationPreprocess(img.data, img.w, img.h);
      var S = Layout.ORI.side;
      var feeds = {};
      feeds[s[0].inputNames[0]] = new ort.Tensor('float32', x, [1, 3, S, S]);
      return s[0].run(feeds);
    })
    .then(function (out) {
      rot = Layout.orientation(out[Object.keys(out)[0]].data);
      if (rot.rotate) img = Layout.rotateRGBA(img.data, img.w, img.h, rot.rotate);
      lap('orient');
      var pre = Layout.preprocess(img.data, img.w, img.h, { model: model });
      var feeds = layoutFeeds(model, pre.data, pre.scale);
      lap('pre');
      stage('suy luận ' + model);
      return sess.run(feeds);
    })
    .then(function (out) {
      lap('infer');
      var num = Number(out[sess.outputNames[1]].data[0]);
      var regions = Layout.postprocess(out[sess.outputNames[0]].data, num, img.w, img.h, { model: model });
      lap('post');
      ms.total = performance.now() - t0;
      var res = {
        type: 'layout',
        id: msg.id,
        model: model,
        width: img.w,
        height: img.h,
        rotate: rot.rotate,
        orientation: { angle: rot.angle, score: rot.score },
        regions: regions.map(function (r) {
          return { index: r.index, cls: r.cls, label: r.label, score: r.score, norm: r.norm };
        }),
        ms: ms,
      };
      if (rot.rotate && !msg.noImage) {
        res.rgba = img.data.buffer; // trang mã hóa lại JPEG đã xoay
        self.postMessage(res, [res.rgba]);
      } else {
        self.postMessage(res);
      }
    })
    .catch(function (e) {
      self.postMessage({ type: 'layoutError', id: msg.id, message: errText(e) });
    });
}

// Báo một lần: có đa luồng wasm (SharedArrayBuffer + crossOriginIsolated) và WebGPU không.
(function probeEnv() {
  var env = {
    type: 'env',
    cores: (self.navigator && self.navigator.hardwareConcurrency) || 0,
    sab: typeof SharedArrayBuffer !== 'undefined',
    isolated: !!self.crossOriginIsolated,
    simd: typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])),
    webgpu: 'không có',
    ua: (self.navigator && self.navigator.userAgent) || '',
  };
  var gpu = self.navigator && self.navigator.gpu;
  if (!gpu) {
    self.postMessage(env);
    return;
  }
  gpu.requestAdapter().then(
    function (a) {
      env.webgpu = a ? 'có adapter' : 'có API, không có adapter';
      self.postMessage(env);
    },
    function (e) {
      env.webgpu = 'lỗi: ' + errText(e);
      self.postMessage(env);
    },
  );
})();

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type === 'asset') {
    var w = assetWaiters[msg.name];
    if (w) w.resolve(msg.bytes);
  } else if (msg.type === 'assetError') {
    var we = assetWaiters[msg.name];
    delete assetWaiters[msg.name];
    if (we) we.reject(new Error(msg.message));
  } else if (msg.type === 'preload') {
    ['ori'].concat(msg.models || []).forEach(function (name) {
      session(name).catch(function () {});
    });
  } else if (msg.type === 'analyze') {
    chain = chain.then(function () {
      return analyze(msg);
    });
  }
};
