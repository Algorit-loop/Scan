/**
 * Màn hình quét chạy trong WebView: camera (getUserMedia), vòng detect qua Worker, vẽ khung, chụp + nắn phẳng.
 *
 * Luồng mỗi khung hình (requestAnimationFrame):
 *   1. Vẽ khung: chế độ Tracker = khung đã lọc (trượt mượt, vàng -> xanh khi đứng yên);
 *      chế độ không Tracker = vẽ thẳng kết quả detect mới nhất.
 *   2. Có khung camera mới và Worker rảnh: cắt đúng vùng người dùng nhìn thấy, thu nhỏ còn detectSide, gửi Worker.
 *      Không giới hạn nhịp: detect nhanh nhất mà Worker và camera cho phép.
 *   3. Kết quả về -> (Tracker lọc) -> gợi ý (hint) gửi app khi đổi.
 * Chụp: lấy vùng nhìn thấy ở độ phân giải gốc -> Worker detect lại + warpPerspective -> JPEG base64 về app.
 *
 * app -> trang: window.__rn({ type: 'capture', id } | { type: 'resume' } | { type: 'config', detectSide, tracker })
 * trang -> app: { type: 'camera', width, height } | { type: 'engine', ok, message? } | { type: 'error', message }
 *               { type: 'status', hint, steady } | { type: 'perf', fps, ms, rt }
 *               { type: 'captured', id, data, width, height, flattened } | { type: 'captureError', id, message }
 */
/* global Tracker, ENGINE_SRC, WORKER_SRC */
(function () {
  var DETECT_SIDE = 256; // cạnh dài khung gửi detect, mặc định (app gửi 'config' để đổi: 256 hoặc 640)
  var OUTPUT_MAX_SIDE = 2400;
  var JPEG_QUALITY = 0.92;
  var HINT_SETTLE_MS = 250;
  var REASON_LOW_CONTRAST = 2;
  var YELLOW = [255, 212, 0];
  var GREEN = [39, 227, 107];

  var video = document.getElementById('video');
  var overlay = document.getElementById('overlay');
  var flashEl = document.getElementById('flash');
  var octx = overlay.getContext('2d');
  var small = document.createElement('canvas');
  var sctx = small.getContext('2d', { willReadFrequently: true });
  var big = document.createElement('canvas');
  var bctx = big.getContext('2d', { willReadFrequently: true });

  var W = 0;
  var H = 0;
  var dpr = 1;
  var tracker = Tracker.create();
  var detectSide = DETECT_SIDE;
  var useTracker = true;
  var rawQuad = null; // chế độ không Tracker: kết quả detect mới nhất
  var frameCallbackOn = false;
  var newFrame = true; // có khung camera mới chưa detect (requestVideoFrameCallback; không có thì luôn true)
  var worker = null;
  var engineReady = false;
  var engineFailed = false;
  var busy = false;
  var paused = false;
  var capturing = false;
  var nextId = 1;
  var lastFrameAt = 0;
  var lastDet = null;
  var sentHint = null;
  var sentSteady = null;
  var hintCandidate = null;
  var hintSince = 0;
  var perf = { n: 0, ms: 0, rt: 0, since: 0 };
  var sentAt = {};

  function send(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function errText(e) {
    return (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : String(e));
  }

  // ---------- Kích thước & vùng nhìn thấy ----------

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    overlay.width = Math.round(W * dpr);
    overlay.height = Math.round(H * dpr);
  }

  /** Vùng của video được hiển thị (object-fit: cover), theo pixel video. */
  function visibleRect() {
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    var s = Math.max(W / vw, H / vh);
    var sw = Math.min(vw, W / s);
    var sh = Math.min(vh, H / s);
    return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw: sw, sh: sh };
  }

  // ---------- Worker / engine ----------

  function startWorker() {
    if (!ENGINE_SRC) {
      engineFailed = true;
      send({ type: 'engine', ok: false, message: 'Chưa build engine WebAssembly (App/native/build-wasm.ps1).' });
      return;
    }
    try {
      var url = URL.createObjectURL(new Blob([ENGINE_SRC, '\n', WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch (e) {
      engineFailed = true;
      send({ type: 'engine', ok: false, message: 'Không tạo được Worker: ' + errText(e) });
      return;
    }
    worker.onmessage = onWorkerMessage;
    worker.onerror = function (e) {
      engineFailed = true;
      send({ type: 'engine', ok: false, message: 'Worker lỗi: ' + (e.message || 'không rõ') });
    };
  }

  function onWorkerMessage(e) {
    var m = e.data;
    if (m.type === 'ready') {
      engineReady = true;
      engineFailed = false;
      send({ type: 'engine', ok: true });
    } else if (m.type === 'fatal') {
      engineFailed = true;
      send({ type: 'engine', ok: false, message: m.message });
    } else if (m.type === 'detect') {
      onDetect(m);
    } else if (m.type === 'capture') {
      onCaptured(m);
    }
  }

  // ---------- Vòng detect ----------

  function startDetect(now) {
    var vw = video.videoWidth;
    if (!vw || video.readyState < 2) return;
    var r = visibleRect();
    var k = Math.min(1, detectSide / Math.max(r.sw, r.sh));
    var w = Math.max(8, Math.round(r.sw * k));
    var h = Math.max(8, Math.round(r.sh * k));
    if (small.width !== w) small.width = w;
    if (small.height !== h) small.height = h;
    sctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    var img = sctx.getImageData(0, 0, w, h);
    var id = nextId++;
    busy = true;
    if (video.requestVideoFrameCallback) newFrame = false;
    sentAt[id] = now;
    worker.postMessage({ type: 'detect', id: id, w: w, h: h, buffer: img.data.buffer }, [img.data.buffer]);
  }

  function onDetect(m) {
    busy = false;
    var now = performance.now();
    var started = sentAt[m.id];
    delete sentAt[m.id];
    if (m.error) {
      lastDet = null;
      return;
    }
    if (paused) return;
    var r = m.result;
    lastDet = r;
    if (window.__scanDebug) window.__scanDebug(r); // móc cho bài thử trên trình duyệt
    if (useTracker) Tracker.update(tracker, r.found ? r.corners : null, now);
    else rawQuad = r.found ? r.corners : null;
    perf.n++;
    perf.ms += r.ms;
    perf.rt += started ? now - started : 0;
  }

  // ---------- Gợi ý ----------

  function touchesEdge(q) {
    for (var i = 0; i < 8; i++) if (q[i] < 0.01 || q[i] > 0.99) return true;
    return false;
  }

  /** Khung dùng cho gợi ý và làm gợi ý khi chụp. */
  function currentQuad() {
    return useTracker ? Tracker.current(tracker, performance.now()) : rawQuad && rawQuad.slice();
  }

  function computeHint(s) {
    if (!engineReady) return engineFailed ? 'no-engine' : 'starting';
    if (!s.visible) return lastDet && lastDet.reason === REASON_LOW_CONTRAST ? 'dark' : 'search';
    var q = currentQuad();
    if (q && Tracker.area(q) < 0.18) return 'closer';
    if (q && touchesEdge(q)) return 'farther';
    if (!useTracker) return 'found'; // không Tracker thì không biết "đứng yên"
    return s.steady ? 'ready' : 'hold';
  }

  function reportHint(s, now) {
    var hint = computeHint(s);
    if (hint !== hintCandidate) {
      hintCandidate = hint;
      hintSince = now;
    }
    // Chờ gợi ý ổn định một chút để chữ không nhảy liên tục; "sẵn sàng" báo ngay.
    var settled = hint === 'ready' || now - hintSince >= HINT_SETTLE_MS;
    if (settled && (hint !== sentHint || s.steady !== sentSteady)) {
      sentHint = hint;
      sentSteady = s.steady;
      send({ type: 'status', hint: hint, steady: s.steady });
    }
    if (now - perf.since >= 1000) {
      if (perf.n) {
        var sec = (now - perf.since) / 1000;
        send({ type: 'perf', fps: perf.n / sec, ms: perf.ms / perf.n, rt: perf.rt / perf.n });
      }
      perf = { n: 0, ms: 0, rt: 0, since: now };
    }
  }

  // ---------- Vẽ ----------

  function mix(a, b, k) {
    return [0, 1, 2].map(function (i) {
      return Math.round(a[i] + (b[i] - a[i]) * k);
    });
  }

  function quadPath(q) {
    octx.moveTo(q[0] * W, q[1] * H);
    for (var i = 2; i < 8; i += 2) octx.lineTo(q[i] * W, q[i + 1] * H);
    octx.closePath();
  }

  function draw(s) {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, W, H);
    if (!s.quad || s.opacity < 0.01) return;
    var q = s.quad;
    var c = mix(YELLOW, GREEN, s.steadyMix).join(',');
    octx.globalAlpha = s.opacity;
    // Làm tối phần ngoài tài liệu để mắt tập trung vào trang.
    octx.beginPath();
    octx.rect(0, 0, W, H);
    quadPath(q);
    octx.fillStyle = 'rgba(0,0,0,0.35)';
    octx.fill('evenodd');
    octx.beginPath();
    quadPath(q);
    octx.fillStyle = 'rgba(' + c + ',0.12)';
    octx.fill();
    octx.lineJoin = 'round';
    octx.lineWidth = 3;
    octx.strokeStyle = 'rgb(' + c + ')';
    octx.stroke();
    for (var i = 0; i < 8; i += 2) {
      octx.beginPath();
      octx.arc(q[i] * W, q[i + 1] * H, 7, 0, Math.PI * 2);
      octx.fillStyle = 'rgb(' + c + ')';
      octx.fill();
      octx.lineWidth = 2;
      octx.strokeStyle = 'rgba(0,0,0,0.6)';
      octx.stroke();
    }
    octx.globalAlpha = 1;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = lastFrameAt ? Math.min(100, now - lastFrameAt) : 16;
    lastFrameAt = now;
    if (paused) return; // giữ nguyên khung cuối khi đang chụp / xem kết quả
    var s = useTracker
      ? Tracker.step(tracker, now, dt)
      : { quad: rawQuad, opacity: rawQuad ? 1 : 0, visible: !!rawQuad, steady: false, steadyMix: 0 };
    draw(s);
    reportHint(s, now);
    if (engineReady && !busy && newFrame) startDetect(now);
  }

  // ---------- Chụp ----------

  function flash() {
    flashEl.classList.remove('on');
    void flashEl.offsetWidth; // khởi động lại animation
    flashEl.classList.add('on');
  }

  function captureError(id, message) {
    capturing = false;
    send({ type: 'captureError', id: id, message: message });
  }

  function capture(id) {
    if (capturing) return captureError(id, 'Đang xử lý ảnh trước.');
    if (!video.videoWidth) return captureError(id, 'Camera chưa sẵn sàng.');
    if (!engineReady && !engineFailed) return captureError(id, 'Bộ nhận diện đang khởi động.');
    capturing = true;
    paused = true;
    try {
      var r = visibleRect();
      var w = Math.round(r.sw);
      var h = Math.round(r.sh);
      big.width = w;
      big.height = h;
      bctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
      video.pause();
      flash();
      var img = bctx.getImageData(0, 0, w, h);
      if (!engineReady) {
        // Không có engine: trả ảnh gốc của vùng nhìn thấy.
        return onCaptured({ id: id, w: w, h: h, buffer: img.data.buffer, flattened: false });
      }
      var hint = currentQuad();
      worker.postMessage(
        { type: 'capture', id: id, w: w, h: h, buffer: img.data.buffer, hint: hint, maxSide: OUTPUT_MAX_SIDE },
        [img.data.buffer],
      );
    } catch (e) {
      captureError(id, errText(e));
    }
  }

  function onCaptured(m) {
    if (m.error) return captureError(m.id, m.error);
    try {
      big.width = m.w;
      big.height = m.h;
      bctx.putImageData(new ImageData(new Uint8ClampedArray(m.buffer), m.w, m.h), 0, 0);
      var url = big.toDataURL('image/jpeg', JPEG_QUALITY);
      big.width = big.height = 1; // trả bộ nhớ canvas
      capturing = false;
      send({
        type: 'captured',
        id: m.id,
        data: url.slice(url.indexOf(',') + 1),
        width: m.w,
        height: m.h,
        flattened: m.flattened,
      });
    } catch (e) {
      captureError(m.id, errText(e));
    }
  }

  function resetView() {
    tracker = Tracker.create();
    rawQuad = null;
  }

  function configure(msg) {
    if (msg.detectSide === 256 || msg.detectSide === 640) detectSide = msg.detectSide;
    if (typeof msg.tracker === 'boolean' && msg.tracker !== useTracker) {
      useTracker = msg.tracker;
      resetView();
    }
    perf = { n: 0, ms: 0, rt: 0, since: performance.now() };
    sentHint = sentSteady = hintCandidate = null;
  }

  function resume() {
    if (capturing) return;
    resetView();
    lastDet = null;
    sentHint = sentSteady = hintCandidate = null;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    paused = false;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
    if (!video.srcObject || !liveTrack()) startCamera();
  }

  // ---------- Camera ----------

  function liveTrack() {
    var s = video.srcObject;
    var t = s && s.getVideoTracks()[0];
    return t && t.readyState === 'live' ? t : null;
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      send({ type: 'error', message: 'WebView không hỗ trợ getUserMedia.' });
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then(function (stream) {
        video.srcObject = stream;
        if (video.requestVideoFrameCallback && !frameCallbackOn) {
          frameCallbackOn = true; // gắn với thẻ video, chỉ đăng ký một lần dù camera mở lại
          var onVideoFrame = function () {
            newFrame = true;
            video.requestVideoFrameCallback(onVideoFrame);
          };
          video.requestVideoFrameCallback(onVideoFrame);
        }
        video.onloadedmetadata = function () {
          var p = video.play();
          if (p && p.catch) p.catch(function (e) { send({ type: 'error', message: 'play: ' + errText(e) }); });
          send({ type: 'camera', width: video.videoWidth, height: video.videoHeight });
        };
      })
      .catch(function (e) {
        send({ type: 'error', message: errText(e) });
      });
  }

  // App quay lại từ nền: camera có thể đã bị hệ điều hành tắt.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !paused && !liveTrack()) startCamera();
  });

  window.__rn = function (msg) {
    if (!msg) return;
    if (msg.type === 'capture') capture(msg.id);
    else if (msg.type === 'resume') resume();
    else if (msg.type === 'config') configure(msg);
  };

  window.addEventListener('resize', resize);
  resize();
  startWorker();
  startCamera();
  requestAnimationFrame(frame);
})();
