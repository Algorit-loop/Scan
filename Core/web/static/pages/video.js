import { api, esc } from "../lib.js";

/** 0.017 -> "1,7%" (tối đa một chữ số thập phân, dấu phẩy kiểu Việt). */
const pct = (v) => `${(Math.round(v * 1000) / 10).toLocaleString("vi-VN")}%`;

// Trang /video: luồng xử lý video của app, phát lại trên video SmartDoc thật.
// Detect chạy ngay trong trình duyệt bằng engine của app (/api/video/engine.js = docdetect.js + App/web/worker.js),
// Tracker là App/web/tracker.js. Sửa app rồi tải lại trang là thấy kết quả mới.

const num = (v, d = 1) => (v == null || Number.isNaN(v) ? "n/a" : Number(v).toFixed(d));
const HINT_TEXT = {
  starting: "Đang khởi động…", "no-engine": "Chưa có bộ nhận diện", search: "Đưa tài liệu vào khung hình",
  dark: "Thiếu sáng hoặc nền quá giống màu giấy", closer: "Đưa camera lại gần hơn", farther: "Lùi ra xa để thấy đủ 4 góc",
  hold: "Giữ yên máy…", ready: "Sẵn sàng, bấm chụp", found: "Đã thấy tài liệu",
};
const HINT_COLOR = { search: "var(--muted)", dark: "var(--c-red)", closer: "var(--c-amber)", farther: "var(--c-amber)", hold: "var(--lines)", ready: "var(--c-green)" };
const LATENCY = 16; // ms từ lúc lấy khung tới lúc có kết quả (đo trên Edge desktop)
const SLOW_PX = 5; // px/khung trên khung gốc: dưới mức này coi như máy gần đứng yên
const detectCache = new Map(); // "video@side" -> kết quả detect từng khung

function loadTracker() {
  if (window.Tracker && window.Tracker.__fresh) return Promise.resolve(window.Tracker);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `/api/video/tracker.js?t=${Date.now()}`;
    s.onload = () => { if (!window.Tracker) return reject(new Error("tracker.js không định nghĩa Tracker")); window.Tracker.__fresh = true; resolve(window.Tracker); };
    s.onerror = () => reject(new Error("Không tải được App/web/tracker.js"));
    document.head.appendChild(s);
  });
}

/** Worker chạy engine WASM của app; gọi theo kiểu promise. */
function makeEngine() {
  const worker = new Worker(`/api/video/engine.js?t=${Date.now()}`);
  const pending = new Map();
  let nextId = 0, onReady, onFail;
  const ready = new Promise((res, rej) => { onReady = res; onFail = rej; });
  worker.onerror = (e) => onFail(new Error(e.message || "Worker lỗi (chưa build engine? chạy App/native/build-wasm.ps1)"));
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "ready") return onReady();
    if (m.type === "fatal") return onFail(new Error(m.message));
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.rej(new Error(m.error)) : p.res(m);
  };
  return {
    ready,
    call(msg, transfer) { const id = ++nextId; return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ ...msg, id }, transfer); }); },
    terminate() { worker.terminate(); },
  };
}

const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`Không tải được ${src}`)); im.src = src; });

/** Như page.js: vẽ khung vào canvas cạnh dài `side`, RGBA, gửi Worker. */
async function detectImage(engine, img, side, canvas) {
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const r = (await engine.call({ type: "detect", w, h, buffer: data.data.buffer }, [data.data.buffer])).result;
  return { found: r.found, reason: r.reason, score: +r.score.toFixed(3), ms: r.ms, corners: r.found ? pairs(r.corners) : null };
}

const flat = (q) => q && q.flat();
const pairs = (f) => f && [[f[0], f[1]], [f[2], f[3]], [f[4], f[5]], [f[6], f[7]]];
const area = (f) => { let s = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; s += f[i * 2] * f[j * 2 + 1] - f[j * 2] * f[i * 2 + 1]; } return Math.abs(s) / 2; };
function cornerErr(a, b, W, H) {
  if (!a || !b) return null;
  let s = 0;
  for (let i = 0; i < 8; i += 2) s += Math.hypot((a[i] - b[i]) * W, (a[i + 1] - b[i + 1]) * H);
  return s / 4;
}

// ------------------------------------------------------------------ mô phỏng (giống page.js)

function computeHint(T, t, s, lastDet, now, tracker) {
  if (!s.visible) return lastDet && lastDet.reason === 2 ? "dark" : "search";
  const q = tracker ? T.current(t, now) : s.quad;
  if (q && area(q) < 0.18) return "closer";
  if (q && q.some((v) => v < 0.01 || v > 0.99)) return "farther";
  if (!tracker) return "found";
  return s.steady ? "ready" : "hold";
}

/** Chạy như app: kết quả khung i đến lúc i/fps + LATENCY, vẽ mỗi 1/60 s. */
function simulate(T, frames, fps, opts, { tracker = true, settle = 250 } = {}) {
  const t = T.create(opts);
  const dtF = 1000 / fps, step = 1000 / 60, total = frames.length * dtF;
  const ticks = [], frameInfo = frames.map(() => ({}));
  let fi = 0, lastDet = null, cand = null, since = 0, shown = "search", raw = null;
  for (let now = 0; now <= total + 600; now += step) {
    while (fi < frames.length && fi * dtF + LATENCY <= now) {
      const f = frames[fi], at = fi * dtF + LATENCY;
      lastDet = f;
      if (tracker) {
        T.update(t, f.found ? flat(f.corners) : null, at);
        frameInfo[fi].rejected = f.found && t.lastSeen !== at;
      } else raw = f.found ? flat(f.corners) : null;
      fi++;
    }
    const s = tracker ? T.step(t, now, step) : { quad: raw, opacity: raw ? 1 : 0, visible: !!raw, steady: false, steadyMix: 0 };
    const hint = computeHint(T, t, s, lastDet, now, tracker);
    if (hint !== cand) { cand = hint; since = now; }
    if (hint === "ready" || now - since >= settle) shown = hint;
    ticks.push({ now, quad: s.quad ? s.quad.slice() : null, opacity: s.opacity, visible: s.visible, steady: s.steady, mix: s.steadyMix,
      target: tracker ? T.current(t, now) : raw && raw.slice(), hint: shown });
  }
  return { ticks, frameInfo, step, dtF };
}

function stats(sim, frames, W, H) {
  const { ticks, frameInfo, step, dtF } = sim;
  const tickAt = (i) => ticks[Math.min(ticks.length - 1, Math.round((i * dtF + LATENCY + dtF * 0.5) / step))];
  const rawErr = { slow: [], fast: [] }, trkErr = { slow: [], fast: [] }, rawJit = [], trkJit = [];
  let prevRaw = null, prevTrk = null, prevGt = null;
  frames.forEach((f, i) => {
    const gt = flat(f.gt), raw = f.found ? flat(f.corners) : null, tk = tickAt(i), trk = tk.visible ? tk.quad : null;
    const speed = gt && prevGt ? cornerErr(gt, prevGt, W, H) : null;
    const b = speed != null && speed < SLOW_PX ? "slow" : "fast";
    if (gt && raw && speed != null) rawErr[b].push(cornerErr(raw, gt, W, H));
    if (gt && trk && speed != null) trkErr[b].push(cornerErr(trk, gt, W, H));
    const ex = (a, pa) => { if (!a || !pa || !gt || !prevGt) return null; let s = 0; for (let k = 0; k < 8; k += 2) s += Math.hypot(((a[k] - pa[k]) - (gt[k] - prevGt[k])) * W, ((a[k + 1] - pa[k + 1]) - (gt[k + 1] - prevGt[k + 1])) * H); return s / 4; };
    const jr = ex(raw, prevRaw), jt = ex(trk, prevTrk);
    if (jr != null) rawJit.push(jr);
    if (jt != null) trkJit.push(jt);
    prevRaw = raw; prevTrk = trk; prevGt = gt;
  });
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  return {
    found: frames.filter((f) => f.found).length, rejected: frameInfo.filter((x) => x.rejected).length,
    rawSlow: med(rawErr.slow), trkSlow: med(trkErr.slow), rawFast: med(rawErr.fast), trkFast: med(trkErr.fast),
    nSlow: rawErr.slow.length, nFast: rawErr.fast.length, rawJit: mean(rawJit), trkJit: mean(trkJit),
    steadyPct: ticks.filter((t) => t.steady).length / ticks.length,
    hintChanges: ticks.reduce((n, t, i) => n + (i && t.hint !== ticks[i - 1].hint ? 1 : 0), 0),
  };
}

// ------------------------------------------------------------------ biểu đồ SVG

function chart({ w = 640, h = 150, xMax, yMax, yLabel = "", series = [], bands = [], marks = [], xLabel = "ms" }) {
  const L = 40, R = 8, Tp = 8, B = 22;
  const X = (x) => L + (x / xMax) * (w - L - R), Y = (y) => Tp + (1 - Math.min(1, y / yMax)) * (h - Tp - B);
  const out = [];
  for (const b of bands) out.push(`<rect x="${X(b.x0)}" y="${b.y0 != null ? Y(b.y1) : Tp}" width="${Math.max(0.5, X(b.x1) - X(b.x0))}" height="${b.y0 != null ? Y(b.y0) - Y(b.y1) : h - Tp - B}" style="fill:${b.color}" fill-opacity="${b.alpha ?? 0.18}"/>`);
  for (let k = 0; k <= 4; k++) {
    const y = (yMax * k) / 4;
    out.push(`<line x1="${L}" x2="${w - R}" y1="${Y(y)}" y2="${Y(y)}" class="grid"/><text x="${L - 4}" y="${Y(y) + 3}" text-anchor="end">${+y.toFixed(3)}</text>`);
  }
  for (let k = 0; k <= 5; k++) out.push(`<text x="${X((xMax * k) / 5)}" y="${h - 6}" text-anchor="middle">${Math.round((xMax * k) / 5)}${k === 5 ? " " + xLabel : ""}</text>`);
  for (const s of series) {
    const pts = s.points.filter((p) => p[1] != null);
    if (s.dots) out.push(pts.map(([x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="${s.r || 2.4}" style="fill:${s.color}"/>`).join(""));
    else {
      let d = "", pen = false;
      for (const [x, y] of s.points) { if (y == null) { pen = false; continue; } d += `${pen ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`; pen = true; }
      out.push(`<path d="${d}" style="stroke:${s.color};fill:none" stroke-width="${s.width || 2}"${s.dash ? ' stroke-dasharray="5 4"' : ""}/>`);
    }
  }
  for (const m of marks) out.push(`<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${Tp}" y2="${h - B}" style="stroke:${m.color}" stroke-dasharray="3 3"/>${m.label ? `<text x="${X(m.x) + 3}" y="${Tp + 10}" style="fill:${m.color}">${esc(m.label)}</text>` : ""}`);
  if (yLabel) out.push(`<text x="${L + 4}" y="${Tp + 10}" class="ylabel">${esc(yLabel)}</text>`);
  return `<svg class="vchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${out.join("")}</svg>`;
}
const legend = (items) => `<div class="vlegend">${items.map(([c, t, dash]) => `<span><i style="background:${dash ? "none" : c};border-color:${c}"${dash ? ' class="dash"' : ""}></i>${t}</span>`).join("")}</div>`;

// ------------------------------------------------------------------ quy tắc của Tracker (dữ liệu tổng hợp)

const BASE = [0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8];
const shift = (dx, dy = 0) => BASE.map((v, i) => v + (i % 2 ? dy : dx));

function ruleDemos(T) {
  const D = T.create().o;
  const run = (events, until, opts) => {
    const t = T.create(opts), ticks = [];
    let e = 0;
    for (let now = 0; now <= until; now += 10) {
      while (e < events.length && events[e][0] <= now) { T.update(t, events[e][1], events[e][0]); e++; }
      const s = T.step(t, now, 10);
      ticks.push({ now, s: { ...s, quad: s.quad && s.quad.slice() }, target: T.current(t, now) });
    }
    return ticks;
  };
  const bands = (ticks, key, color, alpha = 0.18, y) => {
    const out = [];
    let start = null;
    ticks.forEach((k, i) => { const on = k.s[key]; if (on && start == null) start = k.now; if ((!on || i === ticks.length - 1) && start != null) { out.push({ x0: start, x1: k.now, color, alpha, ...y }); start = null; } });
    return out;
  };
  const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const demos = [];
  {
    const ev = [[100, shift(0.25, 0.1)], [150, null], [200, null], [400, shift(0)], [450, shift(0.002)], [500, shift(0.001)], [550, shift(0)], [600, shift(0.001)]];
    const ticks = run(ev, 900);
    demos.push(["Xác nhận rồi mới hiện",
      chart({ xMax: 900, yMax: 0.5, yLabel: "x góc trên trái", bands: bands(ticks, "visible", "var(--c-blue)"),
        series: [{ points: ev.filter((e) => e[1]).map((e) => [e[0], e[1][0]]), dots: true, color: "var(--c-red)", r: 4 },
          { points: ticks.map((k) => [k.now, k.s.quad && k.s.opacity > 0.05 ? k.s.quad[0] : null]), color: "var(--b)" }],
        marks: [{ x: 100, label: "nhận nhầm 1 lần", color: "var(--c-red)" }] }),
      `Một lần nhận nhầm lẻ tẻ (100 ms) không làm khung hiện lên. Tài liệu thật hiện ở lần thấy thứ ${D.confirmHits}.`,
      `Detect đôi khi khoanh nhầm một vật hình chữ nhật trong đúng một khung rồi thôi. Nếu vẽ ngay, người dùng thấy một khung lóe lên rồi tắt. Chờ thấy cùng một chỗ ${D.confirmHits} lần liên tiếp chỉ làm khung hiện chậm thêm ${D.confirmHits - 1} nhịp detect (vài chục ms mỗi nhịp), mắt gần như không nhận ra.`]);
  }
  {
    const r = seeded(7), ev = [];
    for (let now = 0; now <= 1500; now += 50) {
      const move = now < 600 ? 0 : now < 900 ? ((now - 600) / 300) * 0.12 : 0.12;
      ev.push([now, shift(move + r() * 0.012)]);
    }
    const ticks = run(ev, 1600);
    demos.push(["Làm mượt theo tốc độ",
      chart({ xMax: 1600, yMax: 0.36, yLabel: "x góc trên trái", bands: [{ x0: 600, x1: 900, color: "var(--c-amber)", alpha: 0.15 }],
        series: [{ points: ev.map((e) => [e[0], e[1][0]]), dots: true, color: "var(--c-red)" },
          { points: ticks.map((k) => [k.now, k.s.quad ? k.s.quad[0] : null]), color: "var(--b)" }] }),
      "Đứng yên thì lọc mạnh nên hết rung. Khi đưa máy (vùng vàng) bộ lọc nới ra nên khung bám theo, không trễ.",
      "Mỗi lần detect lệch vài điểm ảnh một cách ngẫu nhiên, nên vẽ thẳng thì khung rung liên tục dù máy đứng yên. Lọc mạnh thì hết rung nhưng khung chạy sau tài liệu khi lia máy. Bộ lọc One Euro giải quyết bằng cách đo tốc độ: chậm thì lấy trung bình nhiều lần (mượt), nhanh thì tin kết quả mới gần như ngay (bám sát).",
    ]);
  }
  {
    const r = seeded(3), ev = [];
    for (let now = 0; now <= 1000; now += 50) {
      let q = shift(r() * 0.004);
      if (now === 500) { q = q.slice(); q[5] += 0.1; q[7] += 0.1; }
      ev.push([now, q]);
    }
    const ticks = run(ev, 1000);
    demos.push(["Bỏ qua lần chọn nhầm",
      chart({ xMax: 1000, yMax: 1, yLabel: "y góc dưới phải", bands: bands(ticks, "steady", "var(--c-green)", 0.25),
        series: [{ points: ev.map((e) => [e[0], e[1][5]]), dots: true, color: "var(--c-red)" },
          { points: ticks.map((k) => [k.now, k.s.quad ? k.s.quad[5] : null]), color: "var(--b)" }],
        marks: [{ x: 500, label: "2 góc nhảy 10%", color: "var(--c-red)" }] }),
      `Có góc nhảy quá ${Math.round(D.jumpDist * 100)}% thì phải thấy thêm một lần mới tin. Một lần chọn nhầm bị bỏ qua, khung vẫn xanh.`,
      `Khi hai ứng viên gần điểm nhau (ví dụ mép trang và một khung ảnh in bên trong), detect có thể chọn cái này ở khung này, cái kia ở khung sau. Thường chỉ một hai góc nhảy. Bộ lọc đơn thuần sẽ kéo khung lệch về phía đó; quy tắc này coi cú nhảy là chưa chắc. Nếu người dùng thật sự chuyển sang tờ khác thì lần thấy kế tiếp xác nhận ngay.`]);
  }
  {
    const ev = [];
    for (let now = 0; now <= 400; now += 50) ev.push([now, shift(0)]);
    for (let now = 450; now <= 1050; now += 50) ev.push([now, null]);
    const ticks = run(ev, 1300);
    demos.push(["Mất dấu thì giữ rồi mờ dần",
      chart({ xMax: 1300, yMax: 1, yLabel: "độ đậm khung", bands: bands(ticks, "visible", "var(--c-blue)"),
        series: [{ points: ticks.map((k) => [k.now, k.s.opacity]), color: "var(--b)" }],
        marks: [{ x: 400, label: "lần thấy cuối", color: "var(--c-red)" }] }),
      `Khung giữ ${D.holdMs} ms sau lần thấy cuối rồi mờ dần, không tắt phụt khi detect hụt vài khung.`,
      "Detect hụt vài khung là chuyện thường: tay che một góc, máy rung nhòe ảnh, ánh đèn lóe. Nếu khung tắt ngay mỗi lần hụt thì màn hình nhấp nháy. Giữ khung một lúc rồi mờ dần cho người dùng cảm giác app vẫn đang thấy tài liệu, và nếu tài liệu thật sự đã ra khỏi khung thì khung biến mất êm."]);
  }
  {
    const r = seeded(7), ev = [];
    const amp = D.steadyDist * 1.3;
    for (let now = 0; now <= 2500; now += 50) { const drift = now > 1800 ? (now - 1800) * 0.00012 : 0; ev.push([now, shift(drift + r() * amp)]); }
    const a = run(ev, 2600), b = run(ev, 2600, { steadyExitDist: D.steadyDist });
    const top = D.steadyExitDist * 2.5;
    const err = (q) => q && Math.hypot(q[0] - BASE[0], q[1] - BASE[1]);
    demos.push(["Đứng yên có độ trễ",
      chart({ xMax: 2600, yMax: top, yLabel: "lệch so với vị trí đầu", h: 170,
        bands: [...bands(a, "steady", "var(--c-green)", 0.3, { y0: top / 2, y1: top }), ...bands(b, "steady", "var(--c-amber)", 0.3, { y0: 0, y1: top / 2 })],
        series: [{ points: ev.map((e) => [e[0], err(e[1])]), dots: true, color: "var(--c-red)" }] }),
      `Xanh khi các lần detect nằm trong ${pct(D.steadyDist)} quanh một mốc suốt ${D.steadyMs} ms, chỉ mất xanh khi lệch quá ${pct(D.steadyExitDist)}. Dải trên là cài đặt hiện tại, dải dưới là nếu không có độ trễ: bật tắt liên tục.`,
      `Khung xanh nghĩa là "chụp bây giờ sẽ nét và đúng khung". Tay người không bao giờ đứng yên tuyệt đối, nên ngưỡng vào phải chừa chỗ cho rung tay. Mốc được giữ cố định thay vì so với lần trước, để máy trôi chậm vẫn bị phát hiện. Ngưỡng ra rộng hơn ngưỡng vào (độ trễ) để khung đã xanh không chớp vàng chỉ vì nhiễu detect.`]);
  }
  return demos;
}

// ------------------------------------------------------------------ vẽ một khung của trình phát

function drawFrame(ctx, img, tick, frame, show) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.drawImage(img, 0, 0, cw, ch);
  const path = (q) => { ctx.beginPath(); ctx.moveTo(q[0] * cw, q[1] * ch); for (let i = 2; i < 8; i += 2) ctx.lineTo(q[i] * cw, q[i + 1] * ch); ctx.closePath(); };
  if (show.app && tick?.quad && tick.opacity > 0.01) {
    const c = [0, 1, 2].map((i) => Math.round([255, 212, 0][i] + ([39, 227, 107][i] - [255, 212, 0][i]) * tick.mix)).join(",");
    ctx.globalAlpha = tick.opacity;
    ctx.beginPath(); ctx.rect(0, 0, cw, ch); path(tick.quad); ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fill("evenodd");
    path(tick.quad); ctx.fillStyle = `rgba(${c},0.12)`; ctx.fill();
    ctx.lineJoin = "round"; ctx.lineWidth = 3; ctx.strokeStyle = `rgb(${c})`; ctx.stroke();
    for (let i = 0; i < 8; i += 2) { ctx.beginPath(); ctx.arc(tick.quad[i] * cw, tick.quad[i + 1] * ch, 6, 0, 7); ctx.fillStyle = `rgb(${c})`; ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
  if (show.gt && frame.gt) { path(flat(frame.gt)); ctx.strokeStyle = "#12b886"; ctx.stroke(); }
  if (show.raw && frame.found) { path(flat(frame.corners)); ctx.strokeStyle = "#ff3b5c"; ctx.stroke(); }
  ctx.setLineDash([]);
  if (show.app && tick) {
    const text = HINT_TEXT[tick.hint] || "";
    ctx.font = "600 15px system-ui, sans-serif";
    const tw = ctx.measureText(text).width + 28, x = (cw - tw) / 2, y = ch - 46;
    ctx.fillStyle = tick.hint === "ready" ? "#27E36B" : "rgba(0,0,0,0.6)";
    ctx.beginPath(); ctx.roundRect(x, y, tw, 32, 16); ctx.fill();
    ctx.fillStyle = tick.hint === "ready" ? "#000" : "#fff"; ctx.textAlign = "center"; ctx.fillText(text, cw / 2, y + 21); ctx.textAlign = "start";
  }
}

// ------------------------------------------------------------------ sơ đồ

function archSvg(A) {
  const box = (x, y, w, h, title, lines, cls = "") => `<g class="abox ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><text x="${x + 12}" y="${y + 22}" class="t">${title}</text>${lines.map((l, i) => `<text x="${x + 12}" y="${y + 44 + i * 18}">${l}</text>`).join("")}</g>`;
  const arrow = (x1, y1, x2, y2) => `<g class="aarrow"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/></g>`;
  const path = (d, label, lx, ly, anchor = "middle") => `<g class="aarrow"><path d="${d}" marker-end="url(#ah)"/>${label ? `<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="small">${label}</text>` : ""}</g>`;
  return `<svg class="arch" viewBox="0 0 980 360" role="img" aria-label="Sơ đồ kiến trúc">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z"/></marker></defs>
    <text x="10" y="18" class="lane rn">App React Native (scan.tsx)</text>
    ${box(10, 26, 230, 76, "Nút chụp, gợi ý, rung", ["Tùy chọn 256 / 640, Tracker", "Đọc được bằng trình đọc màn hình"], "rn")}
    ${box(700, 26, 230, 76, "Lưu ảnh, màn kết quả", ["expo-file-system", "expo-image"], "rn")}
    <text x="10" y="146" class="lane wv">WebView, luồng chính (web/page.js)</text>
    ${box(10, 154, 200, 96, "Camera", ["getUserMedia", "video lấp đầy màn", "khoảng 1920×1080"])}
    ${box(250, 154, 210, 96, "Cắt và thu nhỏ", ["phần đang thấy trên màn", `cạnh dài ${A.DETECT_SIDE ?? 256} hoặc 640 px`, "mỗi khung mới, khi rảnh"])}
    ${box(500, 154, 180, 96, "Tracker", ["xác nhận, làm mượt", "giữ khi mất dấu", "đứng yên, gợi ý"])}
    ${box(720, 154, 200, 96, "Vẽ 60 lần/giây", ["khung trượt mượt", "vàng, xanh khi đứng yên", "làm tối ngoài trang"])}
    <text x="10" y="284" class="lane wk">Web Worker (web/worker.js)</text>
    ${box(250, 292, 430, 60, "docdetect_v3.wasm (C++ của Core + OpenCV)", ["detect ra 4 góc, nắn phẳng khi chụp"], "wk")}
    ${arrow(210, 202, 248, 202)}${arrow(460, 202, 498, 202)}${arrow(680, 202, 718, 202)}
    ${path("M330,250 L330,290", "gửi khung", 336, 274, "start")}
    ${path("M590,292 L590,252", "4 góc", 596, 276, "start")}
    ${path("M590,154 L590,128 L200,128 L200,104", "gợi ý khi đổi", 400, 122)}
    ${path("M60,104 L60,152", "chụp, tiếp tục", 66, 132, "start")}
    ${path("M680,330 L955,330 L955,64 L932,64", "ảnh JPEG khi chụp", 950, 312, "end")}
  </svg>`;
}

function timelineSvg() {
  const W = 940, X = (t) => 120 + (t / 200) * (W - 140), rows = [];
  for (let t = 0; t < 200; t += 16.7) rows.push(`<rect x="${X(t)}" y="18" width="${X(t + 4) - X(t)}" height="18" class="g-draw"/>`);
  for (let t = 0; t < 200; t += 33.3) {
    rows.push(`<rect x="${X(t)}" y="46" width="${X(t + 1.5) - X(t)}" height="18" class="g-grab"/>`);
    rows.push(`<rect x="${X(t + 2)}" y="74" width="${X(t + 12) - X(t + 2)}" height="18" class="g-det"/>`);
    rows.push(`<line x1="${X(t + 14)}" x2="${X(t + 14)}" y1="74" y2="40" class="g-back" marker-end="url(#ah2)"/>`);
  }
  return `<svg class="gantt" viewBox="0 0 ${W} 120"><defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z"/></marker></defs>
    <text x="0" y="31">Vẽ khung</text><text x="0" y="59">Cắt, gửi</text><text x="0" y="87">Worker detect</text>
    ${rows.join("")}${[0, 50, 100, 150, 200].map((t) => `<text x="${X(t)}" y="112" text-anchor="middle" class="small">${t} ms</text>`).join("")}</svg>`;
}

// ------------------------------------------------------------------ trang

const TRACKER_DOC = {
  confirmHits: "Số lần thấy liên tiếp trước khi hiện khung", jumpDist: "Có góc nhảy quá mức này thì phải xác nhận lại",
  holdMs: "Giữ khung sau lần thấy cuối (ms)", fadeMs: "Thời gian mờ dần (ms)",
  steadyDist: "Ngưỡng vào trạng thái đứng yên", steadyExitDist: "Ngưỡng ra khỏi đứng yên", steadyMs: "Phải đứng yên bấy lâu (ms)",
  minCutoff: "Lọc khi đứng yên (Hz, thấp là lọc mạnh)", beta: "Bớt lọc theo tốc độ", dCutoff: "Lọc ước lượng tốc độ (Hz)",
  glideMs: "Khung vẽ trượt tới vị trí mới (ms)",
};

export default async function videoPage(main, ctx) {
  const [cfg, videos] = await Promise.all([api("/api/video/config"), api("/api/video")]);
  if (ctx.stale()) return;
  let T = null, trackerError = null;
  try { T = await loadTracker(); } catch (e) { trackerError = e.message; }
  if (ctx.stale()) return;
  const A = cfg.app;
  const D = T ? T.create().o : {};
  const vid = ctx.q.get("v") || videos[0]?.id;
  const side = ctx.q.get("side") === "640" ? 640 : 256;
  const vurl = (o) => `/video?${new URLSearchParams({ v: o.v ?? vid, ...((o.side ?? side) === 640 ? { side: 640 } : {}) })}#replay`;

  main.innerHTML = `<article class="kb">
    <header class="kb-hero"><h1>Luồng xử lý video trong app</h1>
      <p>Camera, detect từng khung, theo dõi cho khung đứng yên và mượt, rồi chụp và nắn phẳng.</p></header>
    <nav class="kb-toc"><a href="#problem">Vì sao cần Tracker</a><a href="#arch">Kiến trúc</a><a href="#frame">Một khung hình</a>
      <a href="#replay">Phát lại video</a><a href="#rules">Quy tắc Tracker</a><a href="#hints">Gợi ý</a><a href="#capture">Chụp</a><a href="#numbers">Số đo</a></nav>
    ${trackerError ? `<div class="kb-note">${esc(trackerError)}</div>` : ""}
    ${cfg.engineAvailable ? "" : `<div class="kb-note">Chưa build engine WASM của app. Chạy <code>App/native/build-wasm.ps1</code> rồi tải lại trang.</div>`}

    <section class="kb-sec" id="problem" style="--c:var(--c-red)"><h2>Vì sao cần Tracker</h2>
      <p class="lead">Mỗi lần detect độc lập. Vẽ thẳng lên màn thì khung rung, chớp và nhảy.</p>
      <div class="kb-explain">
        <p>Thuật toán ở trang Thuật toán làm việc trên từng ảnh và không nhớ gì về ảnh trước. Trên video, mỗi giây có khoảng 30 ảnh gần giống nhau, nhưng kết quả của chúng không giống nhau hoàn toàn. Ba hiện tượng hay gặp, xem trong 6 khung dưới đây:</p>
        <ul><li><b>Rung:</b> bốn góc lệch vài điểm ảnh mỗi khung dù tài liệu đứng yên, do nhiễu camera và ảnh đã thu nhỏ.</li>
        <li><b>Chớp:</b> một vài khung không tìm thấy (ảnh nhòe, tay che), khung biến mất rồi hiện lại.</li>
        <li><b>Nhảy:</b> có khung chọn nhầm một tứ giác khác, ví dụ khung ảnh in bên trong trang.</li></ul>
        <p>Với người dùng, nhất là người nhìn kém, một khung như vậy khó theo dõi và không biết lúc nào nên bấm chụp. <b>Tracker</b> nằm giữa detect và màn hình, biến chuỗi kết quả rời rạc thành một khung mượt, ổn định, và quyết định khi nào báo sẵn sàng.</p>
      </div>
      <div id="strip" class="vstrip"><div class="loading">Đang detect…</div></div>
    </section>

    <section class="kb-sec" id="arch" style="--c:var(--c-violet)"><h2>Kiến trúc</h2>
      <p class="lead">Ba nơi chạy, mỗi nơi một việc.</p>
      <div class="kb-explain">
        <p>App viết bằng React Native và chạy thử bằng Expo Go. Expo Go là app dựng sẵn nên không nạp được mã C++ tự viết. Vì vậy camera và detect được đặt trong một <b>WebView</b> (trình duyệt nhúng trong app): WebView mở được camera và chạy được <b>WebAssembly</b>, tức mã C++ của Core biên dịch cho trình duyệt. Thuật toán trong app vì thế đúng là thuật toán đang đo ở Core, không phải bản viết lại.</p>
        <p>Trong WebView có hai luồng. <b>Luồng chính</b> giữ camera, Tracker và vẽ khung 60 lần mỗi giây. <b>Web Worker</b> là luồng phụ chỉ chạy detect, nhờ vậy trong lúc detect đang tính thì video và khung trên màn vẫn mượt. Phần React Native lo những thứ ngoài camera: nút chụp, chữ gợi ý cho trình đọc màn hình, rung, lưu ảnh và màn kết quả.</p>
      </div>
      ${archSvg(A)}
      <dl class="kb-why">
        <div class="k-why"><dt>Vì sao WebView</dt><dd>Expo Go không nạp được C++ tự viết. WebView có camera và WebAssembly, nên vẫn chạy đúng mã C++ của Core.</dd></div>
        <div class="k-use"><dt>Vì sao Worker</dt><dd>Detect chạy song song, video và khung vẫn mượt trong lúc chờ kết quả.</dd></div>
        <div class="k-get"><dt>React Native làm gì</dt><dd>Nút bấm, chữ gợi ý, rung, lưu ảnh. Chỉ nhận tin khi gợi ý đổi.</dd></div>
      </dl>
    </section>

    <section class="kb-sec" id="frame" style="--c:var(--c-blue)"><h2>Một khung hình đi qua những đâu</h2>
      <p class="lead">Chỉ detect phần người dùng đang thấy, mỗi khi camera có khung mới và Worker rảnh.</p>
      <div class="kb-explain">
        <p>Camera trả ảnh ngang tỉ lệ 16:9, còn màn điện thoại cầm dọc thì hẹp và cao. Video được phóng cho lấp đầy màn nên hai bên bị cắt mất. Nếu detect cả ảnh, app có thể khoanh một tờ giấy mà người dùng không thấy trên màn. Vì vậy mỗi lần detect, app chỉ cắt đúng phần đang hiện trên màn (khung vàng trong hình), thu nhỏ rồi gửi sang Worker.</p>
        <p>Nhịp làm việc như biểu đồ bên dưới: mỗi khi camera có khung mới mà Worker đang rảnh thì gửi khung đó đi; Worker đang bận thì bỏ qua. Kết quả trả về được đưa vào Tracker. Việc vẽ chạy riêng theo nhịp màn hình, nên khung trên màn trượt mượt giữa hai lần có kết quả.</p>
      </div>
      <div id="crop-demo"></div>
      ${timelineSvg()}
      <dl class="kb-why">
        <div class="k-get"><dt>Đúng phần đang thấy</dt><dd>Video lấp đầy màn nên bị cắt hai bên. Detect đúng phần còn lại để khung khớp với hình trên màn.</dd></div>
        <div class="k-use"><dt>256 hay 640 px</dt><dd>Thuật toán luôn xử lý ở 256 px. Chọn 640 thì C++ tự thu nhỏ (đẹp hơn một chút) nhưng phải chép nhiều dữ liệu hơn.</dd></div>
        <div class="k-why"><dt>Không hàng đợi</dt><dd>Luôn detect khung mới nhất. Máy chậm thì nhịp tự giảm, không bị trễ dồn.</dd></div>
      </dl>
    </section>

    <section class="kb-sec" id="replay" style="--c:var(--c-teal)"><h2>Phát lại video thật</h2>
      <p class="lead">Video SmartDoc chạy qua đúng engine WASM và Tracker của app, ngay trong trình duyệt này.</p>
      <div class="kb-explain">
        <p>SmartDoc là bộ video quay tay cầm điện thoại quét tài liệu trên nhiều nền khác nhau, mỗi khung có nhãn bốn góc đúng. Khi mở trang, từng khung được detect bằng engine của app (giống hệt trên điện thoại), rồi phát lại như app sẽ thấy: kết quả mỗi khung đến trễ một chút, qua Tracker, và khung được vẽ 60 lần mỗi giây.</p>
        <p>Cách xem: <b>khung vàng</b> là khung app vẽ, chuyển <b>xanh</b> khi đủ yên để chụp. <b>Viền đỏ đứt</b> là kết quả detect thô của khung đó. Bật "Nhãn đúng" để so với đáp án. Tắt "Có Tracker" để xem app trông ra sao nếu vẽ thẳng kết quả. Bảng bên phải so hai cách bằng số, biểu đồ bên dưới cho thấy độ lệch theo thời gian. Mở "Chỉnh tham số Tracker" để thử giá trị khác, số đo đổi ngay.</p>
      </div>
      <div class="chips video-pick">${videos.map((v) => `<a class="chip${v.id === vid ? " on" : ""}" href="${vurl({ v: v.id })}">${esc(v.background.replace("background", "Nền "))}: ${esc(v.name)}</a>`).join("")}</div>
      <div id="player"><div class="loading">Đang chuẩn bị…</div></div>
    </section>

    <section class="kb-sec" id="rules" style="--c:var(--c-teal)"><h2>Quy tắc của Tracker</h2>
      <p class="lead">Dữ liệu tổng hợp, chạy qua đúng tracker.js của app. Chấm đỏ là kết quả detect, đường cam là khung vẽ ra.</p>
      <div class="kb-explain"><p>Tracker gồm năm quy tắc nhỏ, mỗi quy tắc xử lý một kiểu lỗi ở đầu trang. Mỗi biểu đồ dưới đây dựng một tình huống giả rồi chạy qua đúng <code>tracker.js</code> của app, để thấy riêng tác dụng của từng quy tắc. Trục ngang là thời gian, trục dọc là vị trí một góc (hoặc độ đậm của khung).</p></div>
      <div class="rule-grid">${T ? ruleDemos(T).map(([t, c, p, why]) => `<figure class="rule"><h3>${t}</h3>${c}<p>${p}</p>${why ? `<p class="why">${why}</p>` : ""}</figure>`).join("") : ""}</div>
    </section>

    <section class="kb-sec" id="hints" style="--c:var(--c-amber)"><h2>Gợi ý cho người dùng</h2>
      <p class="lead">Xét từ trên xuống, gặp điều kiện nào trước thì báo điều đó.</p>
      <div class="kb-explain">
        <p>App dành cho người nhìn kém nên dòng gợi ý quan trọng ngang với khung. Nó được đọc bằng trình đọc màn hình và kèm rung, nên <b>mỗi lúc chỉ nói một việc</b>, là việc cần làm trước nhất. Ví dụ tài liệu vừa nhỏ vừa sát mép thì báo "lại gần" trước, vì lại gần xong có khi hết sát mép.</p>
        <p>Gợi ý phải giữ nguyên ${A.HINT_SETTLE_MS ?? 250} ms mới được đổi, để trình đọc màn hình không bị ngắt giữa chừng khi điều kiện chập chờn ở ranh giới. Riêng "Sẵn sàng" hiện ngay vì đó là lúc người dùng cần bấm.</p>
      </div>
      <div class="scroll"><table class="table"><thead><tr><th>Khi nào</th><th>Hiện</th></tr></thead><tbody>
        <tr><td>Không thấy, ảnh quá tối hoặc phẳng</td><td><span class="hint-pill">${HINT_TEXT.dark}</span></td></tr>
        <tr><td>Không thấy tài liệu</td><td><span class="hint-pill">${HINT_TEXT.search}</span></td></tr>
        <tr><td>Tài liệu chiếm dưới 18% màn</td><td><span class="hint-pill">${HINT_TEXT.closer}</span></td></tr>
        <tr><td>Có góc sát mép màn</td><td><span class="hint-pill">${HINT_TEXT.farther}</span></td></tr>
        <tr><td>Đang di chuyển</td><td><span class="hint-pill">${HINT_TEXT.hold}</span></td></tr>
        <tr><td>Đứng yên ${D.steadyMs ?? 500} ms</td><td><span class="hint-pill ready">${HINT_TEXT.ready}</span></td></tr>
        <tr><td>Chế độ không Tracker</td><td><span class="hint-pill">${HINT_TEXT.found}</span></td></tr>
      </tbody></table></div>
    </section>

    <section class="kb-sec" id="capture" style="--c:var(--c-green)"><h2>Khi bấm chụp</h2>
      <p class="lead">Detect lại trên ảnh đầy đủ, đối chiếu với khung theo dõi, rồi nắn phẳng.</p>
      <div class="kb-explain">
        <p>Khung trên màn để hướng dẫn, còn ảnh trả cho người dùng phải chính xác nhất có thể. Khi bấm chụp, app không dùng lại kết quả cũ mà <b>detect lại</b> trên chính khung sẽ được nắn, ở độ phân giải đầy đủ của camera. Nhờ vậy góc khớp đúng với ảnh, kể cả khi tay hơi động lúc bấm.</p>
        <p>Nhưng một lần detect riêng lẻ vẫn có thể chọn nhầm, trong khi khung theo dõi đã được xác nhận qua nhiều khung. Vì vậy hai kết quả được so với nhau: gần nhau thì dùng kết quả detect lại (chính xác hơn), lệch nhiều thì tin khung theo dõi (ổn định hơn). Không thấy tài liệu thì app trả ảnh gốc để người dùng không mất ảnh.</p>
      </div>
      <ol class="kb-steps-row"><li>Dừng video</li><li>Lấy khung ở độ phân giải gốc</li><li>Detect lại</li><li>So với khung đang theo dõi</li><li>Nắn phẳng</li><li>Mở màn kết quả</li></ol>
      <dl class="kb-why">
        <div class="k-get"><dt>Detect lại</dt><dd>Góc khớp nhất với chính ảnh sẽ được nắn.</dd></div>
        <div class="k-why"><dt>Vẫn cần khung theo dõi</dt><dd>Nếu kết quả mới lệch quá ${Math.round((A.CAPTURE_AGREE ?? 0.04) * 100)}% thì có thể là chọn nhầm, dùng khung theo dõi.</dd></div>
        <div class="k-use"><dt>Ảnh ra</dt><dd>Cạnh dài tối đa ${A.OUTPUT_MAX_SIDE ?? 2400} px, JPEG chất lượng ${A.JPEG_QUALITY ?? 0.92}.</dd></div>
      </dl>
      <p class="kb-muted">Thử: dừng trình phát ở phần trên rồi bấm "Chụp khung này".</p>
      <div id="capture-out"></div>
    </section>

    <section class="kb-sec" id="numbers" style="--c:var(--c-violet)"><h2>Số đo và tham số</h2>
      <div class="scroll"><table class="table"><thead><tr><th>Phép đo</th><th>Kết quả</th></tr></thead><tbody>
        <tr><td>WebAssembly so với C++ gốc</td><td>Cùng kết luận 239/239 ảnh, 235 ảnh lệch góc dưới 0,1%</td></tr>
        <tr><td>Thời gian detect trên máy tính</td><td>C++ 7,2 ms, WebAssembly 10,2 ms (trung vị). LSD chiếm khoảng 40%</td></tr>
        <tr><td>Cả trang quét trên Edge</td><td>27 đến 30 lần detect mỗi giây, bằng nhịp camera</td></tr>
        <tr><td>Trên điện thoại</td><td>Chưa đo</td></tr>
      </tbody></table></div>
      <details><summary>Tham số đang dùng trong app</summary>
      <div class="scroll"><table class="table"><thead><tr><th>Tham số</th><th>Giá trị</th><th>Ý nghĩa</th></tr></thead><tbody>
        ${[["DETECT_SIDE", A.DETECT_SIDE, "Cạnh dài khung gửi detect mặc định"], ["HINT_SETTLE_MS", A.HINT_SETTLE_MS, "Gợi ý phải giữ bấy lâu mới đổi (ms)"],
          ["CAPTURE_AGREE", A.CAPTURE_AGREE, "Lệch tối đa giữa detect lúc chụp và khung theo dõi"], ["OUTPUT_MAX_SIDE", A.OUTPUT_MAX_SIDE, "Cạnh dài tối đa ảnh nắn (px)"],
          ...Object.entries(D).map(([k, v]) => [`Tracker.${k}`, v, TRACKER_DOC[k] || ""])].map(([k, v, t]) => `<tr><th><code>${k}</code></th><td>${v ?? "n/a"}</td><td>${t}</td></tr>`).join("")}
      </tbody></table></div><p class="kb-muted">Đọc trực tiếp từ mã nguồn app mỗi lần mở trang.</p></details>
    </section>
  </article>`;

  if (!vid || !T || !cfg.engineAvailable) return;
  const engine = makeEngine();
  let alive = true;
  const cleanup = { stop: () => {} };
  (async () => {
    const el = main.querySelector("#player");
    try {
      await engine.ready;
      const meta = await api(`/api/video/data?v=${encodeURIComponent(vid)}`);
      if (!alive) return;
      const imgs = meta.frames.map((f) => `/api/video/frame?v=${encodeURIComponent(vid)}&i=${f.i}`);
      const key = `${vid}@${side}`;
      let dets = detectCache.get(key);
      if (!dets) {
        el.innerHTML = `<p>Đang detect từng khung bằng engine của app (${side} px)…</p><div class="progress"><i></i></div><p class="kb-muted prog-text"></p>`;
        const bar = el.querySelector(".progress i"), txt = el.querySelector(".prog-text");
        const canvas = document.createElement("canvas");
        dets = [];
        const t0 = performance.now();
        for (let k = 0; k < imgs.length; k++) {
          if (!alive) return;
          dets.push(await detectImage(engine, await loadImage(imgs[k]), side, canvas));
          bar.style.setProperty("--p", `${((k + 1) / imgs.length) * 100}%`);
          txt.textContent = `${k + 1}/${imgs.length} khung`;
        }
        dets.wall = performance.now() - t0;
        detectCache.set(key, dets);
      }
      const frames = meta.frames.map((f, k) => ({ ...f, ...dets[k] }));
      const data = { ...meta, frames, side, imgs, msMedian: [...dets.map((x) => x.ms)].sort((a, b) => a - b)[dets.length >> 1] };
      cleanup.stop = setupPlayer(main, data, T, D, engine, vurl);
    } catch (e) {
      el.innerHTML = `<div class="kb-note">${esc(e.message)}</div>`;
    }
  })();
  return () => { alive = false; cleanup.stop(); engine.terminate(); };
}

// ------------------------------------------------------------------ trình phát, thống kê, chụp

function setupPlayer(main, data, T, defaults, engine, vurl) {
  const { frames, fps, width: W, height: H, imgs: urls } = data;
  const el = main.querySelector("#player");
  const imgs = urls.map((u) => { const im = new Image(); im.decoding = "async"; im.src = u; return im; });
  const opts = { ...defaults };
  let sim = simulate(T, frames, fps, opts);
  const simRaw = simulate(T, frames, fps, opts, { tracker: false });
  let playing = false, raf = 0, t0 = 0, time = 0, speed = 1;
  const show = { app: true, raw: true, gt: false, tracker: true };
  const dur = frames.length * (1000 / fps);
  const sliders = [["jumpDist", 0.02, 0.3, 0.01], ["minCutoff", 0.05, 5, 0.05], ["beta", 0, 200, 5], ["dCutoff", 0.2, 5, 0.1], ["glideMs", 0, 200, 5],
    ["steadyDist", 0.004, 0.08, 0.002], ["steadyExitDist", 0.004, 0.12, 0.002], ["steadyMs", 100, 1500, 50], ["holdMs", 0, 1500, 50], ["confirmHits", 1, 5, 1]].filter(([k]) => k in defaults);
  const cw = Math.min(960, W / 2);

  el.innerHTML = `<div class="player">
    <div class="player-main"><canvas width="${cw}" height="${Math.round((cw * H) / W)}"></canvas>
      <div class="player-bar"><button class="btn sm" data-act="play">▶ Phát</button>
        <input type="range" min="0" max="${frames.length - 1}" value="0" step="1" class="scrub" aria-label="Khung">
        <span class="fcount"></span>
        <select class="speed" aria-label="Tốc độ"><option value="0.25">0,25×</option><option value="0.5">0,5×</option><option value="1" selected>1×</option></select>
        <button class="btn sm primary" data-act="capture">Chụp khung này</button></div>
      <div class="toggles">
        <label class="chip on"><input type="checkbox" data-show="tracker" checked>Có Tracker</label>
        <label class="chip on"><input type="checkbox" data-show="app" checked>Khung app</label>
        <label class="chip on"><input type="checkbox" data-show="raw" checked>Detect thô</label>
        <label class="chip"><input type="checkbox" data-show="gt">Nhãn đúng</label></div>
    </div>
    <div class="player-side">
      <div class="seg"><span class="kb-muted">Khung detect:</span>${[256, 640].map((s) => `<a class="chip${s === data.side ? " on" : ""}" href="${vurl({ side: s })}">${s} px</a>`).join("")}
        <span class="kb-muted">detect ${num(data.msMedian, 1)} ms mỗi khung trong trình duyệt này</span></div>
      <div class="vstats"></div>
      <details><summary>Chỉnh tham số Tracker</summary><div class="sliders">${sliders.map(([k, lo, hi, st]) => `<label><span><code>${k}</code> <b data-v="${k}">${opts[k]}</b></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${opts[k]}" data-k="${k}"></label>`).join("")}
        <div><button class="btn sm" data-act="reset">Về mặc định</button></div></div></details></div>
  </div>
  <div class="vcharts"></div>`;

  const canvas = el.querySelector("canvas"), c2d = canvas.getContext("2d");
  const scrub = el.querySelector(".scrub"), fcount = el.querySelector(".fcount"), playBtn = el.querySelector('[data-act="play"]');
  const current = () => (show.tracker ? sim : simRaw);
  const tickAt = (ms) => current().ticks[Math.min(current().ticks.length - 1, Math.max(0, Math.round(ms / current().step)))];
  const frameAt = (ms) => Math.min(frames.length - 1, Math.max(0, Math.floor(ms / (1000 / fps))));

  function render() {
    const fi = frameAt(time), im = imgs[fi];
    if (im.complete && im.naturalWidth) drawFrame(c2d, im, tickAt(time + 1000 / fps / 2), frames[fi], show);
    else im.onload = () => render();
    scrub.value = fi;
    fcount.textContent = `${fi + 1}/${frames.length}, ${(time / 1000).toFixed(2)} s`;
  }
  function loop() {
    time = Math.max(0, Math.min(dur - 1, (performance.now() - t0) * speed));
    render();
    if (time >= dur - 1) return stop();
    raf = requestAnimationFrame(loop);
  }
  function play() { if (time >= dur - 2) time = 0; playing = true; t0 = performance.now() - time / speed; playBtn.textContent = "❚❚ Dừng"; raf = requestAnimationFrame(loop); }
  function stop() { playing = false; cancelAnimationFrame(raf); playBtn.textContent = "▶ Phát"; }

  function renderStats() {
    const a = stats(sim, frames, W, H), b = stats(simRaw, frames, W, H);
    const row = (label, x, y, unit = "", better = "lower") => {
      const good = x != null && y != null && x !== "n/a" && (better === "lower" ? +x < +y : +x > +y);
      return `<tr><th>${label}</th><td>${y ?? "n/a"}${unit}</td><td class="${good ? "good" : ""}">${x ?? "n/a"}${unit}</td></tr>`;
    };
    el.querySelector(".vstats").innerHTML = `<table class="table"><thead><tr><th>${frames.length} khung, ${num(fps, 0)} fps</th><th>Vẽ thẳng</th><th>Có Tracker</th></tr></thead><tbody>
      ${row(`Lệch nhãn khi gần yên (${a.nSlow} khung)`, num(a.trkSlow), num(b.rawSlow), " px")}
      ${row(`Lệch nhãn khi di chuyển (${a.nFast} khung)`, num(a.trkFast), num(b.rawFast), " px")}
      ${row("Rung thừa mỗi khung", num(a.trkJit, 2), num(b.rawJit, 2), " px")}
      ${row("Thời gian khung xanh", num(a.steadyPct * 100, 0), "0", "%", "higher")}
      <tr><th>Detect thấy, bỏ qua vì nhảy</th><td colspan="2">${a.found}/${frames.length}, bỏ qua ${a.rejected}</td></tr></tbody></table>
      <p class="kb-muted">Lệch nhãn: trung vị khoảng cách 4 góc tới nhãn đúng. Rung thừa: chuyển động của khung không do tài liệu thật di chuyển. Đơn vị px trên khung ${W}×${H}.</p>`;
  }

  function renderCharts() {
    const dtF = 1000 / fps, tk = sim.ticks;
    const errRaw = frames.map((f, i) => [i * dtF, f.found && f.gt ? cornerErr(flat(f.corners), flat(f.gt), W, H) : null]);
    const errTrk = tk.filter((_, k) => k % 2 === 0).map((t) => { const f = frames[frameAt(t.now)]; return [t.now, t.visible && f?.gt ? cornerErr(t.quad, flat(f.gt), W, H) : null]; });
    const yMax = Math.max(20, Math.min(120, Math.ceil((Math.max(...errRaw.map((p) => p[1] || 0)) * 1.1) / 10) * 10));
    const hintBands = [];
    let start = 0;
    tk.forEach((t, i) => { if (i === tk.length - 1 || tk[i + 1].hint !== t.hint) { hintBands.push({ x0: tk[start].now, x1: t.now, color: HINT_COLOR[t.hint] || "var(--muted)", alpha: 0.6, y0: 0, y1: yMax * 0.06 }); start = i + 1; } });
    const rej = sim.frameInfo.map((x, i) => (x.rejected ? { x: i * dtF, color: "var(--c-red)" } : null)).filter(Boolean);
    const miss = frames.map((f, i) => (!f.found ? [i * dtF, yMax * 0.97] : null)).filter(Boolean);
    el.querySelector(".vcharts").innerHTML = `<h3>Lệch so với nhãn theo thời gian</h3>
      ${chart({ w: 940, h: 210, xMax: dur, yMax, yLabel: "px", bands: hintBands, marks: rej,
        series: [{ points: errRaw, dots: true, color: "#ff3b5c", r: 2.2 }, { points: miss, dots: true, color: "var(--muted)", r: 2 }, { points: errTrk, color: "var(--b)", width: 2 }] })}
      ${legend([["#ff3b5c", "Detect thô"], ["var(--b)", "Khung app"], ["var(--muted)", "Không thấy (chấm trên cùng)"], ["var(--c-red)", "Bị bỏ qua vì nhảy", true]])}
      ${legend(Object.entries(HINT_COLOR).map(([k, c]) => [c, HINT_TEXT[k]]))}
      <p class="kb-muted">Dải màu dưới đáy là gợi ý đang hiện. Bấm vào biểu đồ để nhảy tới thời điểm đó.</p>`;
    el.querySelector(".vcharts svg").addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      time = Math.max(0, Math.min(dur - 1, ((((e.clientX - r.left) / r.width) * 940 - 40) / (940 - 48)) * dur));
      if (playing) t0 = performance.now() - time / speed;
      render();
      canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function resim() { sim = simulate(T, frames, fps, opts); renderStats(); renderCharts(); render(); }

  async function capture() {
    stop();
    const fi = frameAt(time), tick = tickAt(time + 1000 / fps / 2);
    const hint = tick?.target || null;
    const out = main.querySelector("#capture-out");
    out.innerHTML = `<div class="loading">Đang chụp khung ${fi + 1}…</div>`;
    out.scrollIntoView({ block: "start", behavior: "smooth" });
    try {
      const img = await loadImage(`/api/video/frame/full?v=${encodeURIComponent(data.id)}&i=${frames[fi].i}`);
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const det = (await engine.call({ type: "detect", w: c.width, h: c.height, buffer: g.getImageData(0, 0, c.width, c.height).data.buffer })).result;
      const px = g.getImageData(0, 0, c.width, c.height);
      const r = await engine.call({ type: "capture", w: c.width, h: c.height, buffer: px.data.buffer, hint, maxSide: 2400 }, [px.data.buffer]);
      const o = document.createElement("canvas");
      o.width = r.w; o.height = r.h;
      o.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(r.buffer), r.w, r.h), 0, 0);
      const maxD = det.found && hint ? Math.max(...[0, 2, 4, 6].map((k) => Math.hypot(det.corners[k] - hint[k], det.corners[k + 1] - hint[k + 1]))) : null;
      const usedDetect = r.corners && det.found && r.corners.every((v, k) => Math.abs(v - det.corners[k]) < 1e-6);
      const decision = !r.flattened ? "Không thấy tài liệu: app trả ảnh gốc."
        : usedDetect ? `Detect lại lệch khung theo dõi ${maxD == null ? "n/a" : num(maxD * 100, 2) + "%"}, dưới ngưỡng: dùng kết quả detect lại.`
        : `Detect lại lệch ${maxD == null ? "nhiều" : num(maxD * 100, 2) + "%"}: dùng khung theo dõi.`;
      const poly = (q, color, extra = "") => `<polygon points="${pairs(q).map(([x, y]) => `${x * c.width},${y * c.height}`).join(" ")}" style="stroke:${color};fill:none" stroke-width="5" ${extra}/>`;
      out.innerHTML = `<h3>Kết quả chụp khung ${fi + 1}</h3><div class="kb-note ${usedDetect ? "good" : "info"}">${decision}</div><div class="kb-figs">
        <figure class="xfig"><div class="xshot" style="--r:${(c.width / c.height).toFixed(4)}"><img src="${img.src}" alt=""><svg viewBox="0 0 ${c.width} ${c.height}" preserveAspectRatio="none">
          ${hint ? poly(hint, "var(--lines)", 'stroke-dasharray="16 10"') : ""}${det.found ? poly(det.corners, "var(--b)") : ""}</svg></div>
          <figcaption>Cam: detect lại trên khung ${c.width}×${c.height}. Vàng đứt: khung theo dõi.</figcaption></figure>
        <figure class="xfig"><img class="warp" src="${o.toDataURL("image/jpeg", 0.9)}" alt="Ảnh nắn phẳng"><figcaption>Ảnh nắn phẳng ${r.w}×${r.h}</figcaption></figure></div>`;
    } catch (err) {
      out.innerHTML = `<div class="kb-note">${esc(err.message)}</div>`;
    }
  }

  el.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "play") playing ? stop() : play();
    if (act === "capture") capture();
    if (act === "reset") {
      Object.assign(opts, defaults);
      el.querySelectorAll("[data-k]").forEach((inp) => { inp.value = opts[inp.dataset.k]; el.querySelector(`[data-v="${inp.dataset.k}"]`).textContent = opts[inp.dataset.k]; });
      resim();
    }
  });
  el.addEventListener("input", (e) => {
    if (e.target === scrub) { stop(); time = +scrub.value * (1000 / fps); render(); }
    if (e.target.matches(".speed")) { speed = +e.target.value; if (playing) t0 = performance.now() - time / speed; }
    if (e.target.dataset.k) {
      const k = e.target.dataset.k;
      opts[k] = +e.target.value;
      el.querySelector(`[data-v="${k}"]`).textContent = opts[k];
      clearTimeout(resim.timer);
      resim.timer = setTimeout(resim, 120);
    }
    if (e.target.dataset.show) {
      show[e.target.dataset.show] = e.target.checked;
      e.target.closest(".chip").classList.toggle("on", e.target.checked);
      render();
    }
  });

  renderStrip(main, data, imgs);
  renderCrop(main, data, imgs[0]);
  renderStats();
  renderCharts();
  imgs[0].onload = render;
  render();
  return () => stop();
}

function renderStrip(main, data, imgs) {
  const { frames, width: W, height: H } = data;
  let best = 0, bestScore = -1;
  for (let i = 0; i + 6 <= frames.length; i++) {
    let s = 0;
    for (let k = i + 1; k < i + 6; k++) {
      const a = frames[k - 1], b = frames[k];
      if (a.found !== b.found) s += 30;
      else if (a.found) s += cornerErr(flat(a.corners), flat(b.corners), W, H);
    }
    if (s > bestScore) { bestScore = s; best = i; }
  }
  main.querySelector("#strip").outerHTML = `<div class="vstrip">${frames.slice(best, best + 6).map((f) => {
    const svg = f.found ? `<polygon points="${f.corners.map(([x, y]) => `${x * W},${y * H}`).join(" ")}" style="stroke:#ff3b5c;fill:none" stroke-width="4"/>` : "";
    return `<figure><div class="xshot" style="--r:${(W / H).toFixed(4)}"><img src="${imgs[f.i - 1].src}" alt=""><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg></div>
      <figcaption>Khung ${f.i}: ${f.found ? `điểm ${f.score}` : "<b>không thấy</b>"}</figcaption></figure>`;
  }).join("")}</div><p class="kb-muted">6 khung liên tiếp (${(6 / data.fps).toFixed(2)} giây) của video ở phần Phát lại, vẽ thẳng kết quả detect.</p>`;
}

function renderCrop(main, data, img) {
  const { width: W, height: H } = data;
  const view = (sw, sh) => { const s = Math.max(sw / W, sh / H); const w = Math.min(W, sw / s), h = Math.min(H, sh / s); return [(W - w) / 2, (H - h) / 2, w, h]; };
  const [px, py, pw, ph] = view(412, 860);
  const [lx, ly, lw, lh] = view(860, 412);
  const k = data.side / Math.max(pw, ph);
  main.querySelector("#crop-demo").innerHTML = `<div class="kb-figs">
    <figure class="xfig"><div class="xshot" style="--r:${(W / H).toFixed(4)}"><img src="${img.src}" alt=""><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <mask id="m1"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#000"/></mask>
      <rect x="0" y="0" width="${W}" height="${H}" style="fill:#000" fill-opacity=".55" mask="url(#m1)"/>
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" style="fill:none;stroke:var(--lines)" stroke-width="6"/>
      <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" style="fill:none;stroke:var(--c-blue)" stroke-width="5" stroke-dasharray="20 12"/></svg></div>
      <figcaption>Vàng: phần thấy khi cầm dọc. Xanh đứt: khi cầm ngang.</figcaption></figure>
    <div class="crop-arrow">thu nhỏ còn<br><b>${Math.round(pw * k)}×${Math.round(ph * k)}</b><br>gửi Worker</div>
    <figure class="xfig" style="flex:0 1 240px"><div class="xshot" style="--r:${(pw / ph).toFixed(4)};--fit-h:240px"><svg viewBox="${px} ${py} ${pw} ${ph}" preserveAspectRatio="none"><image href="${img.src}" width="${W}" height="${H}"/></svg></div>
      <figcaption>Ảnh thật sự được detect khi cầm dọc</figcaption></figure></div>`;
}
