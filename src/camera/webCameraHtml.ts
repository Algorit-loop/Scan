/**
 * Trang web chạy trong WebView: mở camera sau bằng getUserMedia, hiển thị video toàn màn hình
 * và khi app yêu cầu thì cắt một khung hình ra JPEG base64 gửi về app.
 *
 * Giao tiếp:
 *  app -> trang: window.__rn({ type: 'grab', id, maxSide, quality })
 *  trang -> app: { type: 'ready', width, height } | { type: 'frame', id, data, width, height, ms }
 *               | { type: 'error', message } | { type: 'frame', id, error }
 */
export const WEB_CAMERA_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  video { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
</head>
<body>
<video id="v" autoplay playsinline muted></video>
<script>
(function () {
  var v = document.getElementById('v');
  var canvas = document.createElement('canvas');
  var ctx = canvas.getContext('2d');

  function send(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function grab(id, maxSide, quality) {
    var vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) { send({ type: 'frame', id: id, error: 'camera chua san sang' }); return; }
    var t0 = performance.now();
    var s = Math.min(1, maxSide / Math.max(vw, vh));
    var w = Math.round(vw * s), h = Math.round(vh * s);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(v, 0, 0, w, h);
    var url = canvas.toDataURL('image/jpeg', quality);
    send({
      type: 'frame', id: id,
      data: url.slice(url.indexOf(',') + 1),
      width: w, height: h,
      ms: performance.now() - t0
    });
  }

  window.__rn = function (msg) {
    if (msg && msg.type === 'grab') grab(msg.id, msg.maxSide, msg.quality);
  };

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    send({ type: 'error', message: 'WebView khong ho tro getUserMedia' });
    return;
  }

  navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  }).then(function (stream) {
    v.srcObject = stream;
    v.onloadedmetadata = function () {
      var p = v.play();
      if (p && p.catch) p.catch(function (e) { send({ type: 'error', message: 'play: ' + e.message }); });
      send({ type: 'ready', width: v.videoWidth, height: v.videoHeight });
    };
  }).catch(function (e) {
    send({ type: 'error', message: (e && e.name ? e.name + ': ' : '') + (e && e.message ? e.message : e) });
  });
})();
</script>
</body>
</html>`;
