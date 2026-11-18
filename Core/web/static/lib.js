// Tiện ích dùng chung: gọi API, định dạng số, dựng URL, vẽ ảnh + lớp tứ giác.

export async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(body?.detail ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : `Lỗi ${res.status}`);
  return body;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const fmt = {
  iou: (v) => (v == null ? "—" : v.toFixed(3)),
  pct: (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`),
  ms: (v) => (v == null ? "—" : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`),
  int: (n) => (n == null ? "—" : Number(n).toLocaleString("vi-VN")),
  date: (s) => {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
  },
  signed: (v, f) => (v == null ? "" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${f(Math.abs(v))}`),
};

export function iouClass(v) {
  if (v == null) return "";
  return v >= 0.9 ? "good" : v >= 0.5 ? "warn" : "bad";
}

export function iouBadge(p, gtFound) {
  if (!p) return `<span class="badge">—</span>`;
  if (!gtFound) return p.found ? `<span class="badge bad">Báo nhầm</span>` : `<span class="badge good">Đúng: không có</span>`;
  if (!p.found) return `<span class="badge bad">Không thấy</span>`;
  return `<span class="badge ${iouClass(p.iou)}" title="IoU">${fmt.iou(p.iou)}</span>`;
}

export function deltaBadge(d) {
  if (d == null || Math.abs(d) < 0.0005) return "";
  return `<span class="badge ${d > 0 ? "good" : "bad"}" title="IoU chênh so với phiên bản so sánh">${fmt.signed(d, (x) => x.toFixed(3))}</span>`;
}

/** Dựng URL: bỏ tham số rỗng / bằng giá trị mặc định. */
export function href(path, params = {}, defaults = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "" || defaults[k] === v) continue;
    sp.set(k, v);
  }
  const s = sp.toString().replace(/%40/g, "@"); // v2@256 dễ đọc hơn v2%40256
  return s ? `${path}?${s}` : path;
}

export const COLORS = { gt: "var(--gt)", a: "var(--a)", b: "var(--b)", live: "var(--live)" };
export const EXTRA_COLORS = ["#e64980", "#7048e8", "#1098ad", "#82c91e", "#fd7e14"];

/**
 * Ảnh + các lớp tứ giác (tọa độ chuẩn hóa 0..1). Khung giữ đúng tỉ lệ ảnh và vừa với --fit-h của khung cha,
 * nên lớp SVG luôn khớp ảnh.
 * layers: [{pts: [[x,y]x4], color, dash?, dots?, fill?}], lines: [[x1,y1,x2,y2]...]
 */
export function shot({ src, w, h, layers = [], lines = null, badge = "", lazy = true, alt = "" }) {
  const s = Math.max(w, h);
  const P = (x, y) => `${(x * w).toFixed(1)},${(y * h).toFixed(1)}`;
  const svg = [];
  for (const [x1, y1, x2, y2] of lines || []) {
    svg.push(`<line x1="${x1 * w}" y1="${y1 * h}" x2="${x2 * w}" y2="${y2 * h}" style="stroke:var(--lines)" stroke-width="1.5" stroke-opacity=".9"/>`);
  }
  for (const l of layers) {
    if (!l?.pts) continue;
    svg.push(`<polygon points="${l.pts.map(([x, y]) => P(x, y)).join(" ")}" style="stroke:${l.color};fill:${l.fill ? l.color : "none"}" fill-opacity=".1" stroke-width="${l.width || 2}"${l.dash ? ' stroke-dasharray="7 5"' : ""}/>`);
    if (l.dots) for (const [x, y] of l.pts) svg.push(`<circle cx="${x * w}" cy="${y * h}" r="${s * 0.007}" style="fill:${l.color}"/>`);
  }
  return `<div class="shot" style="--r:${(w / h).toFixed(5)}"><img src="${esc(src)}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ""} decoding="async"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${svg.join("")}</svg>${badge ? `<span class="nf">${badge}</span>` : ""}</div>`;
}

/** IoU giữa 2 tứ giác lồi (tọa độ chuẩn hóa) trên ảnh w×h — dùng cho kết quả "Detect lại" (chưa có trong file kết quả). */
export function quadIoU(a, b, w, h) {
  const A = a.map(([x, y]) => [x * w, y * h]);
  const B = b.map(([x, y]) => [x * w, y * h]);
  const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;
  const ccw = (p) => (p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) > 0 ? p : [...p].reverse());
  let out = ccw(A);
  const clip = ccw(B);
  for (let i = 0; i < clip.length && out.length; i++) {
    const [cx1, cy1] = clip[i], [cx2, cy2] = clip[(i + 1) % clip.length];
    const inside = ([x, y]) => (cx2 - cx1) * (y - cy1) - (cy2 - cy1) * (x - cx1) >= 0;
    const cross = ([x1, y1], [x2, y2]) => {
      const a1 = cy2 - cy1, b1 = cx1 - cx2, c1 = a1 * cx1 + b1 * cy1;
      const a2 = y2 - y1, b2 = x1 - x2, c2 = a2 * x1 + b2 * y1;
      const det = a1 * b2 - a2 * b1;
      return det === 0 ? [x2, y2] : [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j], prev = input[(j + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cross(prev, cur));
    }
  }
  const inter = out.length >= 3 ? area(out) : 0;
  const union = area(A) + area(B) - inter;
  return union > 0 ? inter / union : 0;
}

export function cornersToList(corners) {
  return corners?.map((c) => [c.x, c.y]) ?? null;
}

let toastTimer = 0;
export function toast(msg, ms = 3500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(sessionStorage.getItem(key) ?? "null");
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}

/** Đang gõ trong ô nhập? (để phím tắt không cướp phím) */
export const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName) || e.target?.isContentEditable;

export const SIZES = [256, 320, 480, 640];
