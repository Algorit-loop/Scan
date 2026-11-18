/**
 * Theo dõi tứ giác tài liệu qua các lần detect để khung hiển thị êm mắt:
 *  - Chỉ hiện khung khi thấy cùng một tài liệu `confirmHits` lần liên tiếp (lọc báo nhầm lẻ tẻ).
 *  - Làm mượt góc: di chuyển nhỏ (rung tay, nhiễu detect) bị lọc mạnh, di chuyển lớn thì bám nhanh.
 *  - Nhảy sang chỗ khác hẳn phải được xác nhận lại, không giật khung theo một lần detect sai.
 *  - Mất dấu thì giữ khung `holdMs` rồi mờ dần, không tắt phụt.
 *  - "Đứng yên" khi các lần detect nằm gần một mốc liên tục trong `steadyMs` (có độ trễ khi thoát).
 * Tọa độ góc: mảng 8 số [x0,y0,...,x3,y3] chuẩn hóa 0..1, thứ tự TL, TR, BR, BL.
 * Không phụ thuộc DOM; thời gian truyền vào (ms) để test được.
 */
var Tracker = (function () {
  var DEFAULTS = {
    confirmHits: 2,
    jumpDist: 0.08, // theo góc lệch nhiều nhất: ứng viên sai thường chỉ lệch 1-2 góc
    holdMs: 450,
    fadeMs: 220,
    steadyDist: 0.012,
    steadyExitDist: 0.025,
    steadyMs: 650,
    minAlpha: 0.3,
    maxAlpha: 0.85,
    glideMs: 70,
  };

  function create(options) {
    var o = {};
    for (var k in DEFAULTS) o[k] = options && options[k] != null ? options[k] : DEFAULTS[k];
    return {
      o: o,
      target: null,
      display: null,
      pending: null,
      pendingHits: 0,
      anchor: null,
      lastSeen: -Infinity,
      steadySince: Infinity,
      opacity: 0,
      steadyMix: 0,
    };
  }

  /** Khoảng cách trung bình giữa các góc tương ứng. */
  function dist(a, b) {
    var s = 0;
    for (var i = 0; i < 8; i += 2) s += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
    return s / 4;
  }

  /** Khoảng cách của góc lệch nhiều nhất. */
  function maxDist(a, b) {
    var m = 0;
    for (var i = 0; i < 8; i += 2) m = Math.max(m, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
    return m;
  }

  function lerp(a, b, k) {
    var r = new Array(8);
    for (var i = 0; i < 8; i++) r[i] = a[i] + (b[i] - a[i]) * k;
    return r;
  }

  function area(q) {
    var s = 0;
    for (var i = 0; i < 4; i++) {
      var j = (i + 1) % 4;
      s += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
    }
    return Math.abs(s) / 2;
  }

  /** Đếm số lần liên tiếp thấy cùng một tứ giác mới; trả true khi đủ để chấp nhận. */
  function confirm(t, q) {
    if (t.pending && maxDist(q, t.pending) < t.o.jumpDist) t.pendingHits++;
    else t.pendingHits = 1;
    t.pending = q;
    if (t.pendingHits < t.o.confirmHits) return false;
    t.pending = null;
    t.pendingHits = 0;
    return true;
  }

  /** Nạp một kết quả detect: corners = mảng 8 số hoặc null khi không thấy. */
  function update(t, corners, now) {
    if (!corners) {
      t.pending = null;
      t.pendingHits = 0;
      t.anchor = null;
      t.steadySince = Infinity;
      return;
    }
    var q = corners.slice(0, 8);
    if (!t.target || maxDist(q, t.target) >= t.o.jumpDist) {
      // Tài liệu mới (hoặc đã dời hẳn chỗ): chờ xác nhận; trong lúc chờ, khung cũ vẫn giữ theo holdMs.
      if (!confirm(t, q)) return;
      t.target = q;
      if (!t.display || t.opacity < 0.05) t.display = q.slice();
      t.steadySince = now;
    } else {
      t.pending = null;
      t.pendingHits = 0;
      var o = t.o;
      var a = o.minAlpha + (o.maxAlpha - o.minAlpha) * Math.min(1, dist(q, t.target) / o.jumpDist);
      t.target = lerp(t.target, q, a);
    }
    // So với mốc (không phải lần trước) để trôi chậm vẫn bị phát hiện; ngưỡng thoát rộng hơn ngưỡng vào
    // để trạng thái "đứng yên" không nhấp nháy vì nhiễu detect.
    var limit = now - t.steadySince >= t.o.steadyMs ? t.o.steadyExitDist : t.o.steadyDist;
    if (!t.anchor || dist(q, t.anchor) > limit) {
      t.anchor = q;
      t.steadySince = now;
    }
    t.lastSeen = now;
  }

  /** Tiến khung hiển thị tới thời điểm `now` (gọi mỗi khung vẽ). */
  function step(t, now, dt) {
    var o = t.o;
    var since = now - t.lastSeen;
    if (t.target && since > o.holdMs + o.fadeMs) {
      t.target = null;
      t.anchor = null;
      t.steadySince = Infinity;
    }
    var visible = !!t.target && since <= o.holdMs;
    var steady = visible && now - t.steadySince >= o.steadyMs;
    var fade = Math.min(1, dt / o.fadeMs);
    t.opacity += ((visible ? 1 : 0) - t.opacity) * fade;
    if (t.opacity < 0.01 && !t.target) {
      t.opacity = 0;
      t.display = null;
    }
    t.steadyMix += ((steady ? 1 : 0) - t.steadyMix) * Math.min(1, dt / 160);
    if (t.target) {
      t.display = t.display ? lerp(t.display, t.target, 1 - Math.exp(-dt / o.glideMs)) : t.target.slice();
    }
    return { quad: t.display, opacity: t.opacity, visible: visible, steady: steady, steadyMix: t.steadyMix };
  }

  /** Tứ giác đang theo dõi (đã làm mượt) nếu còn hiệu lực, dùng làm gợi ý khi chụp. */
  function current(t, now) {
    return t.target && now - t.lastSeen <= t.o.holdMs ? t.target.slice() : null;
  }

  return { create: create, update: update, step: step, current: current, dist: dist, maxDist: maxDist, area: area };
})();

if (typeof module !== 'undefined') module.exports = Tracker;
