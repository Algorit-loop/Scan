import { api, esc } from "../lib.js";

// Trang /video: luồng xử lý video của app (App/web/page.js + tracker.js + worker.js) giải thích bằng hình,
// phát lại trên video SmartDoc thật với CHÍNH App/web/tracker.js (tải qua /api/video/tracker.js).

const num = (v, d = 1) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
const HINT_TEXT = {
  starting: "Đang khởi động…", "no-engine": "Chưa có bộ nhận diện", search: "Đưa tài liệu vào khung hình",
  dark: "Thiếu sáng hoặc nền quá giống màu giấy", closer: "Đưa camera lại gần hơn", farther: "Lùi ra xa để thấy đủ 4 góc",
  hold: "Giữ yên máy…", ready: "Sẵn sàng — bấm chụp",
};
const HINT_COLOR = { search: "var(--muted)", dark: "var(--bad)", closer: "var(--warn)", farther: "var(--warn)", hold: "var(--lines)", ready: "var(--good)" };
const LATENCY = 16;
const SLOW_PX = 5; // px/khung trên khung gốc: dưới mức này coi như máy gần đứng yên // ms từ lúc lấy khung tới lúc có kết quả detect (vòng đo được trên Edge desktop)

function loadTracker() {
  if (window.Tracker) return Promise.resolve(window.Tracker);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `/api/video/tracker.js?t=${Date.now()}`;
    s.onload = () => (window.Tracker ? resolve(window.Tracker) : reject(new Error("tracker.js không định nghĩa Tracker")));
    s.onerror = () => reject(new Error("Không tải được App/web/tracker.js"));
    document.head.appendChild(s);
  });
}

const flat = (q) => q && q.flat();
const pairs = (f) => f && [[f[0], f[1]], [f[2], f[3]], [f[4], f[5]], [f[6], f[7]]];
const area = (f) => { let s = 0; for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; s += f[i * 2] * f[j * 2 + 1] - f[j * 2] * f[i * 2 + 1]; } return Math.abs(s) / 2; };

/** Lỗi trung bình 4 góc (px trên khung gốc W×H). */
function cornerErr(a, b, W, H) {
  if (!a || !b) return null;
  let s = 0;
  for (let i = 0; i < 8; i += 2) s += Math.hypot((a[i] - b[i]) * W, (a[i + 1] - b[i + 1]) * H);
  return s / 4;
}

// ------------------------------------------------------------------ mô phỏng (giống page.js)

function computeHint(T, t, s, lastDet, now) {
  if (!s.visible) return lastDet && lastDet.reason === 2 ? "dark" : "search";
  const q = T.current(t, now);
  if (q && area(q) < 0.18) return "closer";
  if (q && q.some((v) => v < 0.01 || v > 0.99)) return "farther";
  return s.steady ? "ready" : "hold";
}

/** Chạy Tracker trên chuỗi detect như app: kết quả khung i đến lúc i/fps + LATENCY, vẽ mỗi 1/60 s. */
function simulate(T, frames, fps, opts, { tracker = true, settle = 250 } = {}) {
  const t = T.create(opts);
  const dtF = 1000 / fps, step = 1000 / 60;
  const total = frames.length * dtF;
  const ticks = [];
  const frameInfo = frames.map(() => ({}));
  let fi = 0, lastDet = null, cand = null, since = 0, shown = "search";
  for (let now = 0; now <= total + 600; now += step) {
    while (fi < frames.length && fi * dtF + LATENCY <= now) {
      const f = frames[fi];
      const at = fi * dtF + LATENCY;
      lastDet = f;
      if (tracker) {
        T.update(t, f.found ? flat(f.corners) : null, at);
        frameInfo[fi].accepted = f.found && t.lastSeen === at;
        frameInfo[fi].rejected = f.found && t.lastSeen !== at;
      } else {
        frameInfo[fi].accepted = f.found;
      }
      fi++;
    }
    let s;
    if (tracker) s = T.step(t, now, step);
    else {
      const f = lastDet;
      s = { quad: f && f.found ? flat(f.corners) : null, opacity: f && f.found ? 1 : 0, visible: !!(f && f.found), steady: false, steadyMix: 0 };
    }
    let hint = tracker ? computeHint(T, t, s, lastDet, now) : s.visible ? "hold" : "search";
    if (hint !== cand) { cand = hint; since = now; }
    if (hint === "ready" || now - since >= settle) shown = hint;
    ticks.push({ now, quad: s.quad ? s.quad.slice() : null, opacity: s.opacity, visible: s.visible, steady: s.steady, mix: s.steadyMix,
      target: tracker ? T.current(t, now) : s.quad, hint: shown });
  }
  return { ticks, frameInfo, step, dtF };
}

/** Một câu tóm tắt rút từ số liệu (không viết cứng kết luận). a = có Tracker, b = vẽ thẳng. */
function verdict(a, b) {
  const parts = [];
  if (a.trkJit != null && b.rawJit != null) {
    parts.push(a.trkJit < b.rawJit
      ? `rung thừa giảm ${num(b.rawJit, 1)} → ${num(a.trkJit, 1)} px`
      : `rung thừa <b>không giảm</b> (${num(b.rawJit, 1)} → ${num(a.trkJit, 1)} px) — detect thô vốn đã ổn định, khung trễ sau chuyển động lại tạo thêm sai lệch`);
  }
  const e1 = a.trkSlow != null && b.rawSlow != null ? `${num(b.rawSlow)} → ${num(a.trkSlow)} px khi gần yên` : null;
  const e2 = a.trkFast != null && b.rawFast != null ? `${num(b.rawFast)} → ${num(a.trkFast)} px khi đang di chuyển` : null;
  const worse = (a.trkFast ?? 0) > (b.rawFast ?? 0) || (a.trkSlow ?? 0) > (b.rawSlow ?? 0);
  if (e1 || e2) parts.push(`sai số so với nhãn ${worse ? "<b>tăng</b>" : "giảm"} (${[e1, e2].filter(Boolean).join("; ")})`);
  parts.push(`${a.rejected} lần detect bị bỏ qua vì nhảy`);
  return parts.join("; ") + ".";
}

function stats(sim, frames, W, H) {
  const { ticks, frameInfo, step, dtF } = sim;
  const tickAt = (i) => ticks[Math.min(ticks.length - 1, Math.round((i * dtF + LATENCY + dtF * 0.5) / step))];
  const rawErr = { slow: [], fast: [] }, trkErr = { slow: [], fast: [] };
  let rawJit = [], trkJit = [], prevRaw = null, prevTrk = null, prevGt = null;
  frames.forEach((f, i) => {
    const gt = flat(f.gt), raw = f.found ? flat(f.corners) : null, tk = tickAt(i), trk = tk.visible ? tk.quad : null;
    // Tốc độ thật của tài liệu trên ảnh (theo nhãn): < SLOW_PX px/khung coi là "gần như yên".
    const speed = gt && prevGt ? cornerErr(gt, prevGt, W, H) : null;
    const bucket = speed != null && speed < SLOW_PX ? "slow" : "fast";
    if (gt && raw && speed != null) rawErr[bucket].push(cornerErr(raw, gt, W, H));
    if (gt && trk && speed != null) trkErr[bucket].push(cornerErr(trk, gt, W, H));
    // "Rung thừa": phần chuyển động của khung không giải thích được bằng chuyển động thật (nhãn).
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
    nSlow: rawErr.slow.length, nFast: rawErr.fast.length,
    rawJit: mean(rawJit), trkJit: mean(trkJit),
    steadyPct: ticks.filter((t) => t.steady).length / ticks.length, hintChanges: ticks.reduce((n, t, i) => n + (i && t.hint !== ticks[i - 1].hint ? 1 : 0), 0),
  };
}

// ------------------------------------------------------------------ biểu đồ SVG nhỏ

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
  for (const m of marks) out.push(`<line x1="${X(m.x)}" x2="${X(m.x)}" y1="${Tp}" y2="${h - B}" style="stroke:${m.color}" stroke-dasharray="3 3"/><text x="${X(m.x) + 3}" y="${Tp + 10}" style="fill:${m.color}">${esc(m.label)}</text>`);
  if (yLabel) out.push(`<text x="${L + 4}" y="${Tp + 10}" class="ylabel">${esc(yLabel)}</text>`);
  return `<svg class="vchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${out.join("")}</svg>`;
}

function legend(items) {
  return `<div class="vlegend">${items.map(([c, t, dash]) => `<span><i style="background:${dash ? "none" : c};border-color:${c}"${dash ? ' class="dash"' : ""}></i>${t}</span>`).join("")}</div>`;
}

// ------------------------------------------------------------------ minh họa quy tắc của Tracker (dữ liệu tổng hợp)

const BASE = [0.2, 0.2, 0.8, 0.2, 0.8, 0.8, 0.2, 0.8];
const shift = (dx, dy = 0) => BASE.map((v, i) => v + (i % 2 ? dy : dx));

function ruleDemos(T) {
  const run = (events, until, opts) => {
    const t = T.create(opts);
    const ticks = [];
    let e = 0;
    for (let now = 0; now <= until; now += 10) {
      while (e < events.length && events[e][0] <= now) { T.update(t, events[e][1], events[e][0]); e++; }
      const s = T.step(t, now, 10);
      ticks.push({ now, s: { ...s, quad: s.quad && s.quad.slice() }, target: T.current(t, now) });
    }
    return ticks;
  };
  const visBands = (ticks, color = "var(--accent)") => {
    const out = [];
    let start = null;
    ticks.forEach((k, i) => { const on = k.s.visible; if (on && start == null) start = k.now; if ((!on || i === ticks.length - 1) && start != null) { out.push({ x0: start, x1: k.now, color }); start = null; } });
    return out;
  };
  const steadyBands = (ticks) => {
    const out = [];
    let start = null;
    ticks.forEach((k, i) => { const on = k.s.steady; if (on && start == null) start = k.now; if ((!on || i === ticks.length - 1) && start != null) { out.push({ x0: start, x1: k.now, color: "var(--good)", alpha: 0.25 }); start = null; } });
    return out;
  };
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5); })();
  const demos = [];

  // 1. Xác nhận
  {
    const ev = [[100, shift(0.25, 0.1)], [150, null], [200, null], [400, shift(0)], [450, shift(0.002)], [500, shift(0.001)], [550, shift(0)], [600, shift(0.001)]];
    const ticks = run(ev, 900);
    demos.push(["Hiện khung khi thấy cùng một tài liệu 2 lần liên tiếp",
      chart({ xMax: 900, yMax: 0.5, yLabel: "x góc trên-trái", bands: visBands(ticks),
        series: [{ points: ev.filter((e) => e[1]).map((e) => [e[0], e[1][0]]), dots: true, color: "var(--bad)", r: 4 },
          { points: ticks.map((k) => [k.now, k.s.quad && k.s.opacity > 0.05 ? k.s.quad[0] : null]), color: "var(--b)" }],
        marks: [{ x: 100, label: "báo nhầm 1 lần", color: "var(--bad)" }] }),
      `Detect thấy "tài liệu" ở 100 ms rồi mất — một báo nhầm lẻ tẻ: <b>không hiện</b> gì. Tài liệu thật xuất hiện từ 400 ms: khung chỉ hiện ở lần thứ hai (450 ms). Đổi 50 ms trễ lấy việc màn hình không chớp khung linh tinh.`]);
  }
  // 2. Làm mượt thích ứng
  {
    const ev = [];
    for (let now = 0; now <= 1500; now += 50) {
      const move = now < 600 ? 0 : now < 900 ? ((now - 600) / 300) * 0.12 : 0.12;
      ev.push([now, shift(move + rnd() * 0.012)]);
    }
    const ticks = run(ev, 1600);
    demos.push(["Làm mượt: rung nhỏ bị lọc mạnh, di chuyển lớn thì bám nhanh",
      chart({ xMax: 1600, yMax: 0.36, yLabel: "x góc trên-trái", bands: [{ x0: 600, x1: 900, color: "var(--warn)", alpha: 0.12 }],
        series: [{ points: ev.map((e) => [e[0], e[1][0]]), dots: true, color: "var(--bad)" },
          { points: ticks.map((k) => [k.now, k.target ? k.target[0] : null]), color: "var(--a)", width: 1.5, dash: true },
          { points: ticks.map((k) => [k.now, k.s.quad ? k.s.quad[0] : null]), color: "var(--b)" }] }),
      `Chấm đỏ: góc thô từ detect (nhiễu ±0,6%). Nét đứt: <code>target</code> sau lọc. Mỗi lần detect, target tiến về điểm mới một phần α: α = 0,3 khi lệch nhỏ (lọc mạnh), tăng dần tới 0,85 khi lệch gần ngưỡng nhảy (bám nhanh — vùng vàng là lúc đưa máy). Đường cam là khung <i>vẽ ra</i>: trượt về target với hằng số thời gian 70 ms ở 60 fps, nên chuyển động liền mạch dù detect chỉ ~20 lần/giây.`]);
  }
  // 3. Ứng viên sai
  {
    const ev = [];
    for (let now = 0; now <= 1000; now += 50) {
      let q = shift(rnd() * 0.004);
      if (now === 500) { q = q.slice(); q[5] += 0.1; q[7] += 0.1; }
      ev.push([now, q]);
    }
    const ticks = run(ev, 1000);
    demos.push(["Bỏ qua một lần nhận nhầm ứng viên khác",
      chart({ xMax: 1000, yMax: 1, yLabel: "y góc dưới-phải", bands: steadyBands(ticks),
        series: [{ points: ev.map((e) => [e[0], e[1][5]]), dots: true, color: "var(--bad)" },
          { points: ticks.map((k) => [k.now, k.s.quad ? k.s.quad[5] : null]), color: "var(--b)" }],
        marks: [{ x: 500, label: "2 góc dưới nhảy 10%", color: "var(--bad)" }] }),
      `Thỉnh thoảng thuật toán chọn một tứ giác khác (vd. mép bàn) — chỉ <b>1–2 góc</b> lệch xa. Tracker so <b>góc lệch nhiều nhất</b> với ngưỡng nhảy 8%: vượt ngưỡng thì coi là "tài liệu mới" và đòi xác nhận lần nữa, nên một lần sai bị bỏ qua, khung và trạng thái đứng yên (nền xanh) không bị ảnh hưởng. Lỗi này được phát hiện khi chạy thử app — trung bình 4 góc chỉ lệch 5% nên lọt qua.`]);
  }
  // 4. Mất dấu
  {
    const ev = [];
    for (let now = 0; now <= 400; now += 50) ev.push([now, shift(0)]);
    ev.push([450, null], [500, null], [550, null], [600, null], [650, null], [700, null], [750, null], [800, null], [850, null], [900, null], [950, null], [1000, null], [1050, null]);
    const ticks = run(ev, 1300);
    demos.push(["Mất dấu: giữ khung 450 ms rồi mờ dần",
      chart({ xMax: 1300, yMax: 1, yLabel: "độ đậm khung", bands: visBands(ticks),
        series: [{ points: ticks.map((k) => [k.now, k.s.opacity]), color: "var(--b)" }],
        marks: [{ x: 400, label: "lần thấy cuối", color: "var(--bad)" }] }),
      `Camera rung, tay che một góc, hay detect hụt 1–2 khung là chuyện thường. Khung giữ nguyên ${450} ms sau lần thấy cuối (nền xanh = "đang hiện"), rồi mờ dần (hằng số thời gian 220 ms, gần tắt hẳn sau ~0,6 s) thay vì tắt phụt — mắt không bị giật. Nếu tài liệu xuất hiện lại trong lúc giữ, khung tiếp tục ngay không cần xác nhận lại.`]);
  }
  // 5. Đứng yên có độ trễ
  {
    const ev = [];
    const r5 = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5); })();
    for (let now = 0; now <= 2500; now += 50) { const drift = now > 1800 ? (now - 1800) * 0.00006 : 0; ev.push([now, shift(drift + r5() * 0.016)]); }
    const a = run(ev, 2600), b = run(ev, 2600, { steadyExitDist: 0.012 });
    const err = (q) => q && Math.hypot(q[0] - BASE[0], q[1] - BASE[1]);
    demos.push(["Đứng yên có độ trễ: vào khó, ra cũng khó",
      chart({ xMax: 2600, yMax: 0.06, yLabel: "lệch so với vị trí đầu", h: 170,
        bands: [...steadyBands(a).map((x) => ({ ...x, y0: 0.03, y1: 0.06 })), ...steadyBands(b).map((x) => ({ ...x, y0: 0, y1: 0.03, color: "var(--warn)" }))],
        series: [{ points: ev.map((e) => [e[0], err(e[1])]), dots: true, color: "var(--bad)" }] }),
      `"Đứng yên" (khung chuyển xanh, rung nhẹ một lần) khi các lần detect nằm gần một <b>mốc</b> trong 650 ms. Ngưỡng vào 1,2%, ngưỡng ra 2,5%: dải trên (xanh) là cài đặt hiện tại — trạng thái giữ ổn định dù nhiễu; dải dưới (vàng) là nếu ra = vào — trạng thái bật tắt liên tục, chữ "Sẵn sàng" nhấp nháy. So với <i>mốc</i> (không phải lần trước) nên máy trôi chậm (sau 1800 ms) vẫn bị phát hiện.`]);
  }
  return demos;
}

// ------------------------------------------------------------------ trình phát

function drawFrame(ctx, img, W, H, tick, frame, show) {
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

// ------------------------------------------------------------------ trang

export default async function videoPage(main, ctx) {
  const [cfg, videos] = await Promise.all([api("/api/video/config"), api("/api/video")]);
  if (ctx.stale()) return;
  let T = null, trackerError = null;
  try { T = await loadTracker(); } catch (e) { trackerError = e.message; }
  if (ctx.stale()) return;
  const A = cfg.app;
  const defaults = T ? T.create().o : {};
  const vid = ctx.q.get("v") || videos[0]?.id;

  main.innerHTML = `<article class="algorithm-doc video-doc">
    <div class="page-head"><div><h1>Luồng xử lý video trong app</h1>
      <p>Camera → cắt vùng nhìn thấy → detect (WebAssembly, luồng riêng) → theo dõi &amp; làm mượt → vẽ khung + gợi ý → chụp &amp; nắn phẳng</p></div>
      <a class="btn" href="/algorithms">← Thuật toán detect trên một ảnh</a></div>
    <nav class="algorithm-toc"><a href="/video#problem">Vì sao cần</a><a href="/video#arch">Kiến trúc</a><a href="/video#frame">Một khung hình</a>
      <a href="/video#replay">Phát lại video thật</a><a href="/video#rules">Quy tắc theo dõi</a><a href="/video#hints">Gợi ý</a><a href="/video#capture">Chụp</a><a href="/video#numbers">Số đo &amp; tham số</a></nav>
    ${trackerError ? `<div class="alert">${esc(trackerError)} — các phần mô phỏng không chạy được.</div>` : ""}

    <section class="card algorithm-section" id="problem"><h2>1. Vì sao không vẽ thẳng kết quả detect?</h2>
      <p>Thuật toán ở <a href="/algorithms">trang trước</a> xử lý <b>từng ảnh độc lập</b>. Chạy trên video ~20 lần/giây, các kết quả liên tiếp không giống hệt nhau: góc lệch 1–2 px vì nhiễu cảm biến, thỉnh thoảng không thấy (mờ do chuyển động), hiếm hơn là chọn nhầm một hình chữ nhật khác. Vẽ thẳng ra màn hình thì khung <b>rung, chớp tắt và nhảy</b> — khó chịu và khiến người dùng không biết lúc nào nên chụp.</p>
      <div id="strip" class="vstrip"><div class="loading">Đang xử lý video…</div></div>
      <p>Lớp điều phối (App/web/page.js + tracker.js) giải quyết bằng: xác nhận trước khi hiện, làm mượt theo mức di chuyển, bỏ qua lần nhận nhầm, giữ khung khi mất dấu ngắn, và báo "đứng yên" có độ trễ. Phần 4–5 cho xem từng quy tắc trên dữ liệu thật.</p>
    </section>

    <section class="card algorithm-section" id="arch"><h2>2. Kiến trúc: ba nơi chạy, mỗi nơi một việc</h2>
      ${archSvg(A)}
      <div class="step-why">
        <div><dt>Vì sao chạy trong WebView?</dt><dd>Expo Go chỉ chạy JavaScript, không nạp được thư viện C++ tự viết. Trong WebView có <code>getUserMedia</code> (lấy được từng khung hình) và WebAssembly. <code>docdetect_v3</code> + OpenCV được biên dịch bằng Emscripten nên <b>vẫn là đúng mã C++ của Core</b> (đối chiếu 239 ảnh: cùng kết luận 239/239).</dd></div>
        <div><dt>Vì sao cần Worker?</dt><dd>Detect mất vài chục ms trên điện thoại. Chạy trên luồng chính thì video và khung khựng theo. Worker chạy song song; luồng chính chỉ cắt ảnh, gửi đi (chuyển quyền sở hữu bộ đệm, không sao chép) và vẽ ở 60 fps.</dd></div>
        <div><dt>React Native làm gì?</dt><dd>Chỉ phần giao diện bản địa: nút chụp, nút đóng, chữ gợi ý (để trình đọc màn hình đọc được), rung, lưu file và màn kết quả. Tin nhắn qua cầu nối chỉ gửi khi gợi ý <i>đổi</i>, không gửi mỗi khung.</dd></div>
      </div>
    </section>

    <section class="card algorithm-section" id="frame"><h2>3. Một khung hình đi qua những đâu</h2>
      <div id="crop-demo"></div>
      ${timelineSvg(A)}
      <div class="step-why">
        <div><dt>Cắt đúng vùng người dùng thấy</dt><dd>Video hiển thị kiểu <code>object-fit: cover</code> (lấp đầy màn, cắt bớt hai bên). Detect chỉ trên phần đang thấy, nên khung vẽ ra luôn khớp hình trên màn và tài liệu nằm ngoài màn không bị chọn.</dd></div>
        <div><dt>Vì sao ${A.DETECT_SIDE ?? 384} px?</dt><dd>C++ tự thu về 256 px. Gửi ${A.DETECT_SIDE ?? 384} px (1,5×) để bước thu nhỏ trong C++ (INTER_AREA) vẫn có dữ liệu chống răng cưa, mà bộ đệm chỉ ~${Math.round((((A.DETECT_SIDE ?? 384) ** 2) * 0.56 * 4) / 1024)} KB thay vì ~8 MB của khung 1080p.</dd></div>
        <div><dt>Nhịp detect</dt><dd>Chỉ gửi khung mới khi Worker rảnh và đã qua ≥ ${A.MIN_DETECT_INTERVAL ?? 50} ms (tối đa ~${Math.round(1000 / (A.MIN_DETECT_INTERVAL ?? 50))} lần/giây). Không có hàng đợi: luôn detect khung <i>mới nhất</i>, máy chậm thì tự giảm nhịp chứ không trễ dần.</dd></div>
      </div>
    </section>

    <section class="card algorithm-section" id="replay"><h2>4. Phát lại trên video thật (SmartDoc)</h2>
      <p>Mỗi khung video được detect như app (cạnh dài ${A.DETECT_SIDE ?? 384} px, docdetect_v3), rồi <b>chính file App/web/tracker.js</b> chạy trong trình duyệt này với cùng nhịp thời gian. Video quay ngang nên coi như màn hình ngang (không bị cắt). Đỏ đứt = kết quả detect thô, xanh đứt = nhãn đúng, khung vàng/xanh = cái người dùng thấy.</p>
      <div class="chips video-pick">${videos.map((v) => `<a class="chip${v.id === vid ? " on" : ""}" href="/video?v=${encodeURIComponent(v.id)}#replay">${esc(v.background.replace("background", "nền "))} · ${esc(v.name)}</a>`).join("")}</div>
      <div id="player"><div class="loading">Đang detect từng khung (lần đầu mất vài giây)…</div></div>
    </section>

    <section class="card algorithm-section" id="rules"><h2>5. Từng quy tắc của Tracker</h2>
      <p>Dữ liệu tổng hợp để thấy rõ một hiện tượng mỗi lần, chạy qua đúng <code>tracker.js</code> của app. Chấm đỏ = kết quả detect thô; đường cam = khung vẽ ra.</p>
      <div class="rule-grid">${T ? ruleDemos(T).map(([t, c, p]) => `<figure class="card rule"><figcaption><b>${t}</b></figcaption>${c}<p>${p}</p></figure>`).join("") : ""}</div>
    </section>

    <section class="card algorithm-section" id="hints"><h2>6. Gợi ý cho người dùng</h2>
      <p>Xét theo thứ tự, gặp điều kiện nào trước thì báo điều đó. Gợi ý phải giữ nguyên ${A.HINT_SETTLE_MS ?? 250} ms mới được hiện (riêng "Sẵn sàng" hiện ngay) để chữ không nhảy liên tục.</p>
      <div class="scroll"><table class="table"><thead><tr><th>Điều kiện</th><th>Gợi ý hiển thị</th><th>Vì sao</th></tr></thead><tbody>
        <tr><td>Không có khung, detect báo ảnh phẳng</td><td><span class="hint-pill">${HINT_TEXT.dark}</span></td><td>Độ lệch chuẩn mức xám &lt; 8: tối, chói hoặc giấy trắng trên nền trắng — di chuyển máy không giúp gì, cần đổi ánh sáng/nền.</td></tr>
        <tr><td>Không có khung</td><td><span class="hint-pill">${HINT_TEXT.search}</span></td><td>Chưa có tứ giác nào được xác nhận.</td></tr>
        <tr><td>Khung chiếm &lt; 18% màn</td><td><span class="hint-pill">${HINT_TEXT.closer}</span></td><td>Chữ quá nhỏ để đọc sau khi nắn; mép trang ít pixel nên góc kém chính xác.</td></tr>
        <tr><td>Có góc sát mép màn (&lt; 1%)</td><td><span class="hint-pill">${HINT_TEXT.farther}</span></td><td>C++ kẹp góc vào trong ảnh — góc thật có thể đang ở ngoài, ảnh nắn sẽ bị cụt.</td></tr>
        <tr><td>Có khung, đang di chuyển</td><td><span class="hint-pill">${HINT_TEXT.hold}</span></td><td>Chụp lúc đang di chuyển dễ mờ và góc chưa ổn.</td></tr>
        <tr><td>Đứng yên ≥ ${defaults.steadyMs ?? 650} ms</td><td><span class="hint-pill ready">${HINT_TEXT.ready}</span></td><td>Khung chuyển xanh, nút chụp viền xanh, rung nhẹ một lần.</td></tr>
      </tbody></table></div>
    </section>

    <section class="card algorithm-section" id="capture"><h2>7. Khi bấm chụp</h2>
      ${captureFlowSvg(A)}
      <div class="step-why">
        <div><dt>Vì sao detect lại?</dt><dd>Khung theo dõi đến từ ảnh nhỏ ${A.DETECT_SIDE ?? 384} px và đã qua làm mượt (có độ trễ nhỏ). Lúc chụp, Worker detect lại trên <b>chính ảnh độ phân giải gốc</b> sẽ được nắn — góc khớp với ảnh đó nhất.</dd></div>
        <div><dt>Vì sao vẫn cần khung theo dõi?</dt><dd>Một lần detect đơn lẻ có thể chọn nhầm. Khung theo dõi đã được xác nhận qua nhiều khung. Nếu góc lệch nhiều nhất giữa hai bên ≥ ${((A.CAPTURE_AGREE ?? 0.04) * 100).toFixed(0)}% thì dùng khung theo dõi; không thấy gì cả thì trả ảnh gốc kèm thông báo.</dd></div>
        <div><dt>Nắn phẳng</dt><dd><code>getPerspectiveTransform</code> + <code>warpPerspective</code> (INTER_LINEAR) trong WebAssembly. Kích thước ra = cạnh dài hơn của mỗi cặp cạnh đối, tối đa ${A.OUTPUT_MAX_SIDE ?? 2400} px, JPEG chất lượng ${A.JPEG_QUALITY ?? 0.92}.</dd></div>
      </div>
      <p>Thử trên video: dừng trình phát ở khung bất kỳ rồi bấm <b>Chụp khung này</b> (ở phần 4).</p>
      <div id="capture-out"></div>
    </section>

    <section class="card algorithm-section" id="numbers"><h2>8. Số đo và tham số</h2>
      <div class="scroll"><table class="table"><thead><tr><th>Phép đo</th><th>Kết quả</th><th>Ghi chú</th></tr></thead><tbody>
        <tr><td>WebAssembly so với native (cùng điểm ảnh)</td><td>239/239 cùng kết luận; 235 lệch góc &lt; 0,1%</td><td>App/native/verify, 40 ảnh × 3 bộ × 2 cỡ</td></tr>
        <tr><td>Thời gian detect, máy tính</td><td>native 7,9 ms · wasm 12,0 ms (khung 384 px)</td><td>Trung vị; wasm chậm hơn ~1,5×</td></tr>
        <tr><td>Chạy thử cả trang quét (Edge, camera giả)</td><td>~19 lần detect/s · detect ~4 ms · vòng ~16 ms · nạp engine 0,1 s</td><td>Máy tính; <b>chưa đo trên điện thoại</b></td></tr>
        <tr><td>Kích thước</td><td>engine 3,4 MB · bundle Android 6,4 MB</td><td>wasm nhúng base64 trong trang</td></tr>
      </tbody></table></div>
      <h3>Tham số đang dùng trong app</h3>
      <div class="scroll"><table class="table"><thead><tr><th>Tham số</th><th>Giá trị</th><th>Ý nghĩa</th></tr></thead><tbody>
        ${[["DETECT_SIDE", A.DETECT_SIDE, "px, cạnh dài khung gửi detect"], ["MIN_DETECT_INTERVAL", A.MIN_DETECT_INTERVAL, "ms giữa hai lần detect"], ["HINT_SETTLE_MS", A.HINT_SETTLE_MS, "ms gợi ý phải giữ trước khi hiện"],
          ["CAPTURE_AGREE", A.CAPTURE_AGREE, "góc lệch tối đa giữa detect lúc chụp và khung theo dõi"], ["OUTPUT_MAX_SIDE", A.OUTPUT_MAX_SIDE, "px, cạnh dài tối đa ảnh nắn"],
          ...Object.entries(defaults).map(([k, v]) => [`Tracker.${k}`, v, TRACKER_DOC[k] || ""])].map(([k, v, t]) => `<tr><th><code>${k}</code></th><td>${v ?? "—"}</td><td>${t}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted">Đọc trực tiếp từ App/web/page.js, worker.js và tracker.js mỗi lần mở trang.</p>
    </section>
  </article>`;

  if (!vid || !T) return;
  let data;
  try { data = await api(`/api/video/data?v=${encodeURIComponent(vid)}`); } catch (e) {
    main.querySelector("#player").innerHTML = `<div class="alert">${esc(e.message)}</div>`;
    return;
  }
  if (ctx.stale()) return;
  return setupPlayer(main, data, T, defaults, A);
}

const TRACKER_DOC = {
  confirmHits: "số lần thấy liên tiếp trước khi hiện khung / chấp nhận vị trí mới",
  jumpDist: "góc lệch nhiều nhất vượt mức này = tài liệu khác, cần xác nhận",
  holdMs: "giữ khung sau lần thấy cuối", fadeMs: "thời gian mờ dần",
  steadyDist: "ngưỡng vào trạng thái đứng yên (trung bình 4 góc so với mốc)", steadyExitDist: "ngưỡng ra khỏi đứng yên (độ trễ)",
  steadyMs: "phải đứng yên bấy lâu", minAlpha: "hệ số bám khi lệch nhỏ (lọc mạnh)", maxAlpha: "hệ số bám khi lệch lớn",
  glideMs: "hằng số thời gian khung vẽ trượt tới vị trí mới",
};

function archSvg(A) {
  const box = (x, y, w, h, title, lines, cls = "") => `<g class="abox ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/><text x="${x + 12}" y="${y + 22}" class="t">${title}</text>${lines.map((l, i) => `<text x="${x + 12}" y="${y + 44 + i * 18}">${l}</text>`).join("")}</g>`;
  const arrow = (x1, y1, x2, y2) => `<g class="aarrow"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah)"/></g>`;
  const path = (d, label, lx, ly, anchor = "middle") => `<g class="aarrow"><path d="${d}" marker-end="url(#ah)"/>${label ? `<text x="${lx}" y="${ly}" text-anchor="${anchor}" class="small">${label}</text>` : ""}</g>`;
  return `<svg class="arch" viewBox="0 0 980 360" role="img" aria-label="Sơ đồ kiến trúc: React Native, WebView, Worker">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z"/></marker></defs>
    <text x="10" y="18" class="lane">App React Native — scan.tsx</text>
    ${box(10, 26, 230, 76, "Nút chụp · gợi ý · rung", ["accessibilityLiveRegion", "Haptics khi vừa đứng yên"], "rn")}
    ${box(700, 26, 230, 76, "Lưu JPEG → màn kết quả", ["expo-file-system (cache)", "expo-image hiển thị"], "rn")}
    <text x="10" y="146" class="lane">WebView, luồng chính — web/page.js</text>
    ${box(10, 154, 200, 96, "Camera", ["getUserMedia (camera sau)", "&lt;video&gt; object-fit: cover", "~1920×1080, 30 fps"])}
    ${box(250, 154, 210, 96, "Cắt + thu nhỏ", ["vùng nhìn thấy → canvas", `cạnh dài ${A.DETECT_SIDE ?? 384} px, RGBA`, `≥ ${A.MIN_DETECT_INTERVAL ?? 50} ms, khi Worker rảnh`])}
    ${box(500, 154, 180, 96, "Tracker", ["xác nhận · làm mượt", "giữ / mờ · đứng yên", "→ gợi ý"])}
    ${box(720, 154, 200, 96, "Vẽ 60 fps (rAF)", ["khung trượt mượt", "vàng → xanh khi đứng yên", "làm tối ngoài trang"])}
    <text x="10" y="284" class="lane">Web Worker — web/worker.js</text>
    ${box(250, 292, 430, 60, "docdetect_v3.wasm (C++ Core + OpenCV, Emscripten)", ["scan_detect → 4 góc · scan_warp → nắn phẳng"], "wk")}
    ${arrow(210, 202, 248, 202)}
    ${arrow(680, 202, 718, 202)}
    ${path("M460,202 L498,202", "", 0, 0)}
    ${path("M330,250 L330,290", "postMessage (chuyển bộ đệm)", 336, 274, "start")}
    ${path("M590,292 L590,252", "kết quả", 596, 276, "start")}
    ${path("M590,154 L590,128 L200,128 L200,104", "status khi gợi ý đổi", 400, 122)}
    ${path("M60,104 L60,152", "capture / resume", 66, 132, "start")}
    ${path("M680,330 L955,330 L955,64 L932,64", "JPEG base64 khi chụp", 950, 312, "end")}
  </svg>`;
}

function timelineSvg(A) {
  // Gantt 200 ms: vẽ mỗi 16,7 ms; detect mỗi ≥ 50 ms (số đo Edge desktop: lấy ảnh ~1 ms, vòng ~16 ms).
  const W = 940, X = (t) => 120 + (t / 200) * (W - 140);
  const rows = [];
  for (let t = 0; t < 200; t += 16.7) rows.push(`<rect x="${X(t)}" y="18" width="${X(t + 4) - X(t)}" height="18" class="g-draw"/>`);
  for (let t = 0; t < 200; t += 52) {
    rows.push(`<rect x="${X(t)}" y="46" width="${X(t + 1.5) - X(t)}" height="18" class="g-grab"/>`);
    rows.push(`<rect x="${X(t + 2)}" y="74" width="${X(t + 14) - X(t + 2)}" height="18" class="g-det"/>`);
    rows.push(`<line x1="${X(t + 16)}" x2="${X(t + 16)}" y1="74" y2="40" class="g-back" marker-end="url(#ah2)"/>`);
  }
  return `<svg class="gantt" viewBox="0 0 ${W} 120"><defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z"/></marker></defs>
    <text x="0" y="31">Vẽ khung (rAF)</text><text x="0" y="59">Cắt + gửi</text><text x="0" y="87">Worker detect</text>
    ${rows.join("")}${[0, 50, 100, 150, 200].map((t) => `<text x="${X(t)}" y="112" text-anchor="middle" class="small">${t} ms</text>`).join("")}</svg>
    <p class="muted">Nhịp minh họa theo số đo trên máy tính (Edge, camera giả): mỗi ô xanh là một lần vẽ, ô cam là một lần detect ~4 ms + chờ đổi luồng ~12 ms. Trên điện thoại ô cam dài hơn; vẽ vẫn đều vì không chờ detect.</p>`;
}

function captureFlowSvg() {
  const steps = ["Bấm chụp", "Dừng video, nháy trắng", "Cắt vùng nhìn thấy ở độ phân giải gốc", "Worker: detect lại", "So với khung theo dõi", "warpPerspective", "JPEG → app → màn kết quả"];
  return `<ol class="algorithm-flow capture-flow">${steps.map((s) => `<li><b>${s}</b></li>`).join("")}</ol>`;
}

// ------------------------------------------------------------------ trình phát + thống kê + chụp

function setupPlayer(main, data, T, defaults, A) {
  const { frames, fps, width: W, height: H } = data;
  const el = main.querySelector("#player");
  const imgs = frames.map((f) => { const im = new Image(); im.decoding = "async"; im.src = `/api/video/frame?v=${encodeURIComponent(data.id)}&i=${f.i}`; return im; });
  const opts = { ...defaults };
  let sim = simulate(T, frames, fps, opts), simRaw = simulate(T, frames, fps, opts, { tracker: false });
  let playing = false, raf = 0, t0 = 0, time = 0, speed = 1;
  const show = { app: true, raw: true, gt: false, tracker: true };
  const dur = frames.length * (1000 / fps);
  const sliders = [["jumpDist", 0.02, 0.3, 0.01], ["steadyDist", 0.004, 0.05, 0.002], ["steadyExitDist", 0.004, 0.08, 0.002], ["glideMs", 0, 400, 10], ["holdMs", 0, 1500, 50], ["confirmHits", 1, 5, 1], ["minAlpha", 0.05, 1, 0.05]];

  el.innerHTML = `<div class="player">
    <div class="player-main"><canvas width="${Math.min(960, W / 2)}" height="${Math.round(Math.min(960, W / 2) * H / W)}"></canvas>
      <div class="player-bar"><button class="btn sm" data-act="play">▶ Phát</button>
        <input type="range" min="0" max="${frames.length - 1}" value="0" step="1" class="scrub" aria-label="Khung">
        <span class="fcount"></span>
        <select class="speed"><option value="0.25">0,25×</option><option value="0.5">0,5×</option><option value="1" selected>1×</option></select>
        <button class="btn sm primary" data-act="capture">Chụp khung này</button></div>
      <div class="chips toggles">
        <label class="chip on"><input type="checkbox" data-show="tracker" checked>Có Tracker</label>
        <label class="chip on"><input type="checkbox" data-show="app" checked>Khung app</label>
        <label class="chip on"><input type="checkbox" data-show="raw" checked>Detect thô</label>
        <label class="chip"><input type="checkbox" data-show="gt">Nhãn đúng</label></div>
    </div>
    <div class="player-side"><div class="vstats"></div>
      <details><summary>Chỉnh tham số Tracker (chạy lại ngay)</summary><div class="sliders">${sliders.map(([k, lo, hi, st]) => `<label><span><code>${k}</code> <b data-v="${k}">${opts[k]}</b></span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${opts[k]}" data-k="${k}"></label>`).join("")}
        <div class="chips"><button class="btn sm" data-act="reset">Về mặc định</button><button class="btn sm" data-act="suggest">Thử bộ đề xuất</button></div></div></details></div>
  </div>
  <div class="vcharts"></div>`;

  const canvas = el.querySelector("canvas"), c2d = canvas.getContext("2d");
  const scrub = el.querySelector(".scrub"), fcount = el.querySelector(".fcount"), playBtn = el.querySelector('[data-act="play"]');
  const current = () => (show.tracker ? sim : simRaw);
  const tickAt = (ms) => current().ticks[Math.min(current().ticks.length - 1, Math.max(0, Math.round(ms / current().step)))];
  const frameAt = (ms) => Math.min(frames.length - 1, Math.floor(ms / (1000 / fps)));

  function render() {
    const fi = frameAt(time);
    const im = imgs[fi];
    if (im.complete && im.naturalWidth) drawFrame(c2d, im, W, H, tickAt(time + 1000 / fps / 2), frames[fi], { ...show, app: show.app });
    else im.onload = () => render();
    scrub.value = fi;
    fcount.textContent = `${fi + 1}/${frames.length} · ${(time / 1000).toFixed(2)} s`;
  }
  function loop() {
    // Mốc của rAF có thể sớm hơn performance.now() lúc bấm phát -> dùng performance.now() và kẹp >= 0.
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
      const good = x != null && y != null && (better === "lower" ? x < y : x > y);
      return `<tr><th>${label}</th><td>${y ?? "—"}${unit}</td><td class="${good ? "good" : ""}"><b>${x ?? "—"}${unit}</b></td></tr>`;
    };
    el.querySelector(".vstats").innerHTML = `<table class="table"><thead><tr><th>${frames.length} khung · ${num(fps, 0)} fps</th><th>Vẽ thẳng detect</th><th>Có Tracker</th></tr></thead><tbody>
      ${row(`Sai số góc khi gần yên (${a.nSlow} khung)`, num(a.trkSlow), num(b.rawSlow), " px")}
      ${row(`Sai số góc khi đang di chuyển (${a.nFast} khung)`, num(a.trkFast), num(b.rawFast), " px")}
      ${row("Rung thừa mỗi khung", num(a.trkJit, 2), num(b.rawJit, 2), " px")}
      ${row("Số lần đổi gợi ý", a.hintChanges, b.hintChanges)}
      ${row("Thời gian khung xanh (đứng yên)", num(a.steadyPct * 100, 0), "0", "%", "higher")}
      <tr><th>Detect thấy / bỏ qua vì nhảy</th><td colspan="2">${a.found}/${frames.length} · bỏ qua ${a.rejected}</td></tr></tbody></table>
      <p class="muted">Sai số = trung vị khoảng cách 4 góc tới nhãn; "gần yên" = nhãn dịch &lt; ${SLOW_PX} px/khung. "Rung thừa" = chuyển động của khung không do tài liệu/camera thật sự di chuyển (đã trừ chuyển động của nhãn). Pixel trên khung gốc ${W}×${H}.</p>
      <p class="tradeoff"><b>Video này:</b> ${verdict(a, b)}</p>
      <p class="tradeoff"><b>Hai điểm yếu của Tracker mà trang này làm lộ ra</b> (kết quả thật, chưa sửa trong app): (1) khi máy lia liên tục, hệ số bám α tính theo ngưỡng nhảy 8% nên rất nhỏ (~0,35) và khung đi sau tài liệu ~20–30 px; (2) một lần nhận nhầm có góc lệch <i>sát dưới</i> ngưỡng nhảy vẫn được nhận và kéo khung lệch (nền 01, khung 169). Video SmartDoc quay khi camera di chuyển liên tục, không có đoạn đứng yên hẳn như lúc người dùng chụp. Bấm <b>Thử bộ đề xuất</b> (jumpDist 0,05 · minAlpha 0,6 · glideMs 40) để so: trên nền 01–03 sai số giảm ~30%. Nền 04–05: bản thân detect đã sai phần lớn, Tracker không cứu được.</p>`;
  }

  function renderCharts() {
    const dtF = 1000 / fps;
    const tk = sim.ticks;
    const errRaw = frames.map((f, i) => [i * dtF, f.found && f.gt ? cornerErr(flat(f.corners), flat(f.gt), W, H) : null]);
    const errTrk = tk.filter((_, k) => k % 2 === 0).map((t) => { const f = frames[frameAt(t.now)]; return [t.now, t.visible && f?.gt ? cornerErr(t.quad, flat(f.gt), W, H) : null]; });
    const yMax = Math.max(20, Math.min(120, Math.ceil((Math.max(...errRaw.map((p) => p[1] || 0)) * 1.1) / 10) * 10));
    const hintBands = [];
    let start = 0;
    tk.forEach((t, i) => { if (i === tk.length - 1 || tk[i + 1].hint !== t.hint) { hintBands.push({ x0: tk[start].now, x1: t.now, color: HINT_COLOR[t.hint] || "var(--muted)", alpha: 0.5, y0: 0, y1: yMax * 0.06 }); start = i + 1; } });
    const rej = sim.frameInfo.map((x, i) => (x.rejected ? { x: i * dtF, label: "", color: "var(--bad)" } : null)).filter(Boolean);
    const miss = frames.map((f, i) => (!f.found ? [i * dtF, yMax * 0.97] : null)).filter(Boolean);
    el.querySelector(".vcharts").innerHTML = `<h3>Sai số so với nhãn theo thời gian</h3>
      ${chart({ w: 940, h: 210, xMax: dur, yMax, yLabel: "px (trung bình 4 góc)", bands: hintBands, marks: rej,
        series: [{ points: errRaw, dots: true, color: "#ff3b5c", r: 2.2 }, { points: miss, dots: true, color: "var(--muted)", r: 2 }, { points: errTrk, color: "var(--b)", width: 2 }] })}
      ${legend([["#ff3b5c", "detect thô"], ["var(--b)", "khung app (có Tracker)"], ["var(--muted)", "khung không thấy (chấm trên cùng)"], ["var(--bad)", "detect bị bỏ qua vì nhảy", true]])}
      ${legend(Object.entries(HINT_COLOR).map(([k, c]) => [c, `dải dưới: ${HINT_TEXT[k]}`]))}
      <p class="muted">Bấm vào biểu đồ để nhảy tới thời điểm đó.</p>`;
    el.querySelector(".vcharts svg").addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 940;
      time = Math.max(0, Math.min(dur - 1, ((x - 40) / (940 - 48)) * dur));
      if (playing) t0 = performance.now() - time / speed;
      render();
      canvas.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function resim() {
    sim = simulate(T, frames, fps, opts);
    renderStats(); renderCharts(); render();
  }

  el.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "play") playing ? stop() : play();
    if (act === "reset" || act === "suggest") {
      Object.assign(opts, defaults, act === "suggest" ? { jumpDist: 0.05, minAlpha: 0.6, glideMs: 40 } : {});
      el.querySelector(".player-side details").open = true;
      el.querySelectorAll("[data-k]").forEach((inp) => { inp.value = opts[inp.dataset.k]; el.querySelector(`[data-v="${inp.dataset.k}"]`).textContent = opts[inp.dataset.k]; });
      resim();
    }
    if (act === "capture") {
      stop();
      const fi = frameAt(time);
      const tick = tickAt(time + 1000 / fps / 2);
      const q = show.tracker && tick?.target ? `&q=${tick.target.map((v) => v.toFixed(5)).join(",")}` : "";
      const out = main.querySelector("#capture-out");
      out.innerHTML = `<div class="loading">Đang chụp khung ${fi + 1}…</div>`;
      out.scrollIntoView({ block: "start", behavior: "smooth" });
      try { out.innerHTML = captureResult(await api(`/api/video/capture?v=${encodeURIComponent(data.id)}&i=${frames[fi].i}${q}`), fi + 1); }
      catch (err) { out.innerHTML = `<div class="alert">${esc(err.message)}</div>`; }
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

  // Dải ảnh ở phần 1: 6 khung liên tiếp có detect thay đổi nhiều nhất.
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
  const cells = frames.slice(best, best + 6).map((f) => {
    const svg = f.found ? `<polygon points="${f.corners.map(([x, y]) => `${x * W},${y * H}`).join(" ")}" style="stroke:#ff3b5c;fill:none" stroke-width="3"/>` : "";
    return `<figure><div class="xshot" style="--r:${(W / H).toFixed(4)}"><img src="${imgs[f.i - 1].src}" alt=""><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg></div>
      <figcaption>khung ${f.i}: ${f.found ? `điểm ${f.score}` : "<b>không thấy</b>"}</figcaption></figure>`;
  }).join("");
  main.querySelector("#strip").innerHTML = `<div class="strip-row">${cells}</div><p class="muted">6 khung liên tiếp (${(6 / data.fps).toFixed(2)} s) của video đang chọn ở phần 4, kết quả detect thô (đỏ) — đoạn có kết quả thay đổi nhiều nhất.</p>`;
}

function renderCrop(main, data, img) {
  const { width: W, height: H } = data;
  const view = (sw, sh) => { const s = Math.max(sw / W, sh / H); const w = Math.min(W, sw / s), h = Math.min(H, sh / s); return [(W - w) / 2, (H - h) / 2, w, h]; };
  const [px, py, pw, ph] = view(412, 860);
  const [lx, ly, lw, lh] = view(860, 412);
  const side = data.detectSide;
  const k = side / Math.max(pw, ph);
  main.querySelector("#crop-demo").innerHTML = `<div class="step-figs">
    <figure class="xfig"><div class="xshot" style="--r:${(W / H).toFixed(4)}"><img src="${img.src}" alt=""><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <rect x="0" y="0" width="${W}" height="${H}" style="fill:#000" fill-opacity=".55" mask="url(#m1)"/>
      <mask id="m1"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="#000"/></mask>
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" style="fill:none;stroke:var(--lines)" stroke-width="6"/>
      <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" style="fill:none;stroke:var(--accent)" stroke-width="5" stroke-dasharray="20 12"/></svg></div>
      <figcaption>Khung camera ${W}×${H}. Vàng: phần thấy được khi cầm <b>dọc</b> (màn 412×860, cắt còn ${Math.round(pw)}×${Math.round(ph)}). Xanh đứt: cầm <b>ngang</b> (gần như cả khung).</figcaption></figure>
    <div class="crop-arrow">→ thu nhỏ<br><b>${Math.round(pw * k)}×${Math.round(ph * k)}</b><br>RGBA → Worker</div>
    <figure class="xfig zoom"><div class="xshot" style="--r:${(pw / ph).toFixed(4)};--fit-h:240px"><svg viewBox="${px} ${py} ${pw} ${ph}" preserveAspectRatio="none"><image href="${img.src}" width="${W}" height="${H}"/></svg></div>
      <figcaption>Ảnh thật sự được detect (cầm dọc): đúng vùng người dùng thấy.</figcaption></figure></div>`;
}

function captureResult(r, n) {
  const W = r.width, H = r.height;
  const poly = (q, color, extra = "") => `<polygon points="${q.map(([x, y]) => `${x * W},${y * H}`).join(" ")}" style="stroke:${color};fill:none" stroke-width="4" ${extra}/>`;
  const decision = r.used === "detect"
    ? (r.hint ? `Góc lệch nhiều nhất giữa detect lúc chụp và khung theo dõi = <b>${num(r.maxDist * 100, 2)}%</b> &lt; ${num(r.agree * 100, 0)}% → dùng <b>kết quả detect trên ảnh gốc</b>.` : `Không có khung theo dõi → dùng kết quả detect trên ảnh gốc.`)
    : r.used === "tracked" ? (r.detect.found ? `Lệch <b>${num(r.maxDist * 100, 2)}%</b> ≥ ${num(r.agree * 100, 0)}% → lần detect này có thể chọn nhầm, dùng <b>khung theo dõi</b>.` : `Detect lúc chụp không thấy → dùng <b>khung theo dõi</b>.`)
    : "Không thấy tài liệu và không có khung theo dõi → app trả ảnh gốc kèm thông báo.";
  return `<h3>Kết quả chụp khung ${n}</h3><p>${decision}</p><div class="step-figs">
    <figure class="xfig"><div class="xshot" style="--r:${(W / H).toFixed(4)}"><img src="${r.frame}" alt=""><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${r.hint ? poly(r.hint, "var(--lines)", 'stroke-dasharray="14 10"') : ""}${r.detect.corners ? poly(r.detect.corners, "var(--b)") : ""}</svg></div>
      <figcaption>Cam: detect lại trên khung ${W}×${H}. Vàng đứt: khung theo dõi lúc bấm.</figcaption></figure>
    ${r.warp ? `<figure class="xfig"><img class="warp" src="${r.warp}" alt="Ảnh nắn phẳng"><figcaption>Ảnh nắn phẳng (dùng ${r.used === "detect" ? "detect" : "khung theo dõi"})</figcaption></figure>` : ""}</div>`;
}
