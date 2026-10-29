"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  version: $("version"), drop: $("drop"), file: $("file"), busy: $("busy"), notice: $("notice"),
  dropTitle: $("dropTitle"), dropHint: $("dropHint"),
  viewer: $("viewer"), canvas: $("canvas"), tabs: $("tabs"), toggles: $("toggles"),
  showQuad: $("showQuad"), showLines: $("showLines"), zoom: $("zoom"),
  empty: $("empty"), info: $("info"), history: $("history"), historyEmpty: $("historyEmpty"), count: $("count"),
  shell: $("shell"), paneBtn: $("paneBtn"), paneCollapse: $("paneCollapse"), scrim: $("scrim"),
  lightbox: $("lightbox"), lbBody: $("lbBody"), lbClose: $("lbClose"), veil: $("veil"),
};

const SIDE_NAMES = ["Cạnh trên", "Cạnh phải", "Cạnh dưới", "Cạnh trái"];
const CORNER_NAMES = ["Trên-trái", "Trên-phải", "Dưới-phải", "Dưới-trái"];
const SURE = 0.6; // từ mức này trở lên coi là chắc chắn

const state = { items: [], current: null, tab: "original", uploading: 0 };

// ---------- API ----------
async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try { msg = (await res.json()).detail || msg; } catch { /* không phải JSON */ }
    throw new Error(msg);
  }
  return res.json();
}

const fileUrl = (id, kind) => `/api/detections/${id}/files/${kind}`;

// ---------- Tiện ích ----------
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const ms = (v) => `${Math.round(v)} ms`;

function tone(r) {
  if (!r.found) return "bad";
  return r.confidence >= SURE ? "ok" : "warn";
}

function statusText(r) {
  if (!r.found) return r.reason === "lowContrast" ? "Ảnh quá phẳng, tương phản thấp" : "Không thấy tài liệu";
  return r.confidence >= SURE ? "Tìm thấy tài liệu" : "Chưa chắc chắn";
}

const pad2 = (n) => String(n).padStart(2, "0");
function when(iso) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function showNotice(msg) {
  els.notice.textContent = msg;
  els.notice.hidden = !msg;
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(c ?? ""));
  return el;
}

// ---------- Phiên bản detect ----------
async function loadDetectors() {
  const list = await api("/api/detectors");
  els.version.replaceChildren(...list.map((d) => h("option", { value: d.version, title: d.description }, `${d.version} — ${d.name}`)));
  const def = list.find((d) => d.default) || list[0];
  if (def) els.version.value = def.version;
}

// ---------- Lịch sử ----------
async function loadHistory() {
  state.items = await api("/api/detections");
  renderHistory();
}

function renderHistory() {
  els.count.textContent = state.items.length ? `(${state.items.length})` : "";
  els.historyEmpty.hidden = state.items.length > 0;
  els.drop.classList.toggle("compact", state.items.length > 0);
  els.history.replaceChildren(
    ...state.items.map((it) => {
      const t = tone(it);
      const badge = it.found ? `${Math.round(it.confidence * 100)}%` : "Không";
      return h("button", { class: `item${state.current?.id === it.id ? " on" : ""}`, type: "button", "data-id": it.id,
        onclick: () => { show(it.id); closeDrawer(); }, title: `${it.filename} — ${statusText(it)}` },
        h("img", { src: fileUrl(it.id, "thumb"), alt: "", loading: "lazy" }),
        h("span", { class: `dot ${t}` }),
        h("div", { class: "meta" }, h("b", {}, it.filename), h("span", {}, `${it.version} · ${when(it.createdAt)}`)),
        h("span", { class: `pill ${t}` }, badge),
      );
    }),
  );
  els.history.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
}

// ---------- Cột danh sách: thu gọn (máy tính) / ngăn kéo (điện thoại) ----------
const narrow = () => window.matchMedia("(max-width: 960px)").matches;
function setCollapsed(v) {
  els.shell.classList.toggle("collapsed", v);
  const label = v ? "Mở rộng danh sách" : "Thu gọn danh sách";
  els.paneCollapse.title = label;
  els.paneCollapse.setAttribute("aria-label", label);
  try { localStorage.setItem("paneCollapsed", v ? "1" : "0"); } catch { /* bỏ qua */ }
}
function togglePane() {
  if (narrow()) document.body.classList.toggle("drawer");
  else setCollapsed(!els.shell.classList.contains("collapsed"));
}
function closeDrawer() { document.body.classList.remove("drawer"); }
try { setCollapsed(localStorage.getItem("paneCollapsed") === "1"); } catch { /* bỏ qua */ }
els.paneBtn.addEventListener("click", togglePane);
els.paneCollapse.addEventListener("click", togglePane);
els.scrim.addEventListener("click", closeDrawer);

// ---------- Hiển thị một kết quả ----------
async function show(id, { push = true } = {}) {
  try {
    state.current = await api(`/api/detections/${id}`);
  } catch (e) {
    showNotice(e.message);
    return;
  }
  showNotice("");
  if (push) history.replaceState(null, "", `#${id}`);
  if (state.tab === "warped" && !state.current.files.warped) state.tab = "original";
  renderViewer();
  renderInfo();
  renderHistory();
}

/** Ảnh + lớp phủ (khung, đường thẳng, nhãn trạng thái). Dùng cho cả khung xem và phóng to. */
function buildFrame(rec, tab) {
  const isOriginal = tab === "original";
  const img = h("img", { src: fileUrl(rec.id, isOriginal ? "original" : "warped"), alt: rec.filename, draggable: "false" });
  const frame = h("div", { class: "frame" }, img);
  if (isOriginal) {
    frame.append(buildOverlay(rec));
    const r = rec.result;
    const label = r.found && r.confidence >= SURE ? `Tìm thấy · ${pct(r.confidence)}`
      : r.found ? `Chưa chắc chắn · ${pct(r.confidence)}` : statusText(r);
    frame.append(h("div", { class: `chip ${tone(r)}` }, label));
  }
  return frame;
}

function renderViewer() {
  const rec = state.current;
  els.empty.hidden = !!rec;
  els.viewer.hidden = !rec;
  els.shell.classList.toggle("no-info", !rec);
  if (!rec) return;

  const hasWarp = !!rec.files.warped;
  for (const b of els.tabs.querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.tab === state.tab);
    if (b.dataset.tab === "warped") b.disabled = !hasWarp;
  }
  const isOriginal = state.tab === "original";
  const hasLines = (rec.result.debug?.lines ?? []).length > 0;
  els.toggles.hidden = !isOriginal;
  els.showQuad.disabled = !rec.result.found;
  els.showQuad.parentElement.classList.toggle("off", !rec.result.found);
  els.showLines.disabled = !hasLines;
  els.showLines.parentElement.classList.toggle("off", !hasLines);

  els.canvas.replaceChildren(buildFrame(rec, state.tab));
}

function buildOverlay(rec) {
  const [w, hgt] = rec.imageSize;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
  svg.setAttribute("preserveAspectRatio", "none");
  if (rec.result.found && rec.result.confidence < SURE) svg.classList.add("weak"); // nét đứt: kết quả chưa chắc
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text) el.textContent = text;
    svg.append(el);
    return el;
  };

  if (els.showLines.checked && !els.showLines.disabled) {
    for (const [x0, y0, x1, y1] of rec.result.debug?.lines ?? []) {
      add("line", { class: "l-line", x1: x0 * w, y1: y0 * hgt, x2: x1 * w, y2: y1 * hgt });
    }
  }
  if (els.showQuad.checked && rec.result.found) {
    const pts = rec.result.corners.map((c) => [c.x * w, c.y * hgt]);
    const poly = pts.map((p) => p.join(",")).join(" ");
    add("polygon", { class: "q-fill", points: poly });
    add("polygon", { class: "q-line", points: poly });
    // Bán kính theo kích thước ảnh nên vòng góc trông đều ở mọi độ phân giải.
    const r = Math.max(w, hgt) / 90;
    pts.forEach(([x, y], i) => {
      add("circle", { class: "q-dot", cx: x, cy: y, r });
      add("text", { class: "q-label", x, y, "font-size": r * 1.2 }, String(i + 1));
    });
  }
  return svg;
}

function meter(label, value, extra = "", cls) {
  const t = cls || (value >= 0.6 ? "ok" : value >= 0.35 ? "warn" : "bad");
  return h("div", { class: "meter" },
    h("div", { class: "meter-row" }, h("span", {}, label), h("span", {}, extra || pct(value))),
    h("div", { class: `bar ${t}` }, h("i", { style: `width:${Math.max(0, Math.min(1, value)) * 100}%` })),
  );
}

function hintFor(r) {
  if (!r.found) {
    return r.reason === "lowContrast"
      ? "Ảnh gần như một màu nên không có cạnh để tìm. Thử ảnh có nền khác màu với giấy."
      : "Không có tứ giác nào đủ điểm. Có thể ảnh không chứa tài liệu, hoặc mép giấy bị che/chìm vào nền.";
  }
  if (r.confidence < SURE) {
    return "Khung này có thể sai: điểm thấp. Xem cạnh nào yếu ở bên dưới, hoặc bật “Đường thẳng tìm được” để xem thuật toán thấy gì.";
  }
  return null;
}

function renderInfo() {
  const rec = state.current;
  els.info.hidden = !rec;
  if (!rec) return;
  const r = rec.result;
  const dbg = r.debug || {};
  const t = tone(r);
  const [w, hgt] = rec.imageSize;
  const parts = [];

  parts.push(h("div", { class: "info-top" },
    h("span", { class: `badge ${t}` }, statusText(r)),
    h("span", { class: "muted small" }, when(rec.createdAt)),
  ));
  parts.push(h("div", { class: "fname", title: rec.filename }, rec.filename));

  // Nút thao tác đặt ngay trên cùng để không bị đẩy ra khỏi tầm nhìn.
  const actions = [h("a", { class: "btn", href: fileUrl(rec.id, "original"), download: rec.filename }, "Ảnh gốc"),
    h("a", { class: "btn", href: fileUrl(rec.id, "annotated"), download: `${rec.id}-khung.jpg` }, "Ảnh có khung")];
  if (rec.files.warped) actions.push(h("a", { class: "btn", href: fileUrl(rec.id, "warped"), download: `${rec.id}-phang.jpg` }, "Ảnh phẳng"));
  actions.push(h("a", { class: "btn", href: `/api/detections/${rec.id}`, target: "_blank", rel: "noopener" }, "JSON"));
  actions.push(h("button", { class: "btn danger", type: "button", onclick: () => remove(rec.id) }, "Xóa"));
  parts.push(h("div", { class: "actions" }, actions));

  const hint = hintFor(r);
  if (hint) parts.push(h("div", { class: `hint${r.found ? "" : " bad"}` }, hint));

  if (r.found) {
    parts.push(meter("Độ tin cậy", r.confidence, pct(r.confidence), t));

    const d = dbg.scoreDetail;
    if (d) {
      parts.push(h("div", { class: "sec-title" }, "Chất lượng từng cạnh"));
      parts.push(h("div", { class: "sides" }, SIDE_NAMES.map((name, i) =>
        h("div", { class: "side-box" }, meter(name, d.coverage[i] * d.contrast[i])))));
    }

    parts.push(h("div", { class: "sec-title" }, "4 góc (chuẩn hóa · pixel)"));
    parts.push(h("table", { class: "corners" },
      h("tbody", {}, r.corners.map((c, i) =>
        h("tr", {}, h("td", {}, `${i + 1}. ${CORNER_NAMES[i]}`),
          h("td", {}, `${c.x.toFixed(3)}, ${c.y.toFixed(3)}`),
          h("td", { class: "muted" }, `${Math.round(c.x * w)}, ${Math.round(c.y * hgt)}`))),
      ),
    ));
  }

  const rows = [
    ["Phiên bản", rec.version],
    ["Phương pháp", r.method ?? "—"],
    ["Kích thước ảnh", `${w} × ${hgt}`],
    ["Dung lượng", `${(rec.bytes / 1024).toFixed(0)} KB`],
  ];
  if (r.found) {
    rows.push(["Diện tích khung", pct(r.areaRatio)]);
    const names = { left: "trái", right: "phải", top: "trên", bottom: "dưới" };
    const touch = Object.entries(r.touches).filter(([, v]) => v).map(([k]) => names[k]);
    rows.push(["Chạm mép ảnh", touch.length ? touch.join(", ") : "không"]);
  }
  if (dbg.score != null) rows.push(["Điểm khung", dbg.score.toFixed(3)]);
  else if (dbg.bestScore != null) rows.push(["Điểm cao nhất", `${dbg.bestScore.toFixed(3)} (dưới ngưỡng)`]);
  if (dbg.sharpness != null) rows.push(["Độ nét (Laplacian)", String(dbg.sharpness)]);
  if (dbg.candidates != null) rows.push(["Số ứng viên", `${dbg.candidates} · ${dbg.lines?.length ?? 0} đường`]);
  rows.push(["Thời gian detect", ms(rec.timingsMs.detect)]);
  rows.push(["Thời gian giải mã ảnh", ms(rec.timingsMs.decode)]);
  parts.push(h("dl", { class: "kv" }, rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));

  els.info.replaceChildren(...parts);
}

async function remove(id) {
  if (!confirm("Xóa kết quả này khỏi thư mục data?")) return;
  try {
    await api(`/api/detections/${id}`, { method: "DELETE" });
  } catch (e) {
    showNotice(e.message);
    return;
  }
  const idx = state.items.findIndex((i) => i.id === id);
  state.items.splice(idx, 1);
  if (state.current?.id === id) {
    state.current = null;
    history.replaceState(null, "", location.pathname);
    const next = state.items[Math.min(idx, state.items.length - 1)];
    if (next) await show(next.id);
    else { renderViewer(); renderInfo(); }
  }
  renderHistory();
}

// ---------- Phóng to ----------
function openLightbox() {
  if (!state.current) return;
  els.lbBody.replaceChildren(buildFrame(state.current, state.tab));
  els.lightbox.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  els.lightbox.hidden = true;
  els.lbBody.replaceChildren();
  document.body.style.overflow = "";
}

// ---------- Upload ----------
function setBusy(text) {
  els.busy.hidden = !text;
  els.dropTitle.textContent = text || "Kéo ảnh vào đây, bấm để chọn, hoặc dán (Ctrl+V)";
  els.dropHint.hidden = !!text;
}

async function upload(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name));
  if (!images.length) {
    showNotice("Không có file ảnh hợp lệ. Hãy chọn JPG, PNG hoặc WebP.");
    return;
  }
  showNotice("");
  let lastId = null;
  const errors = [];
  for (const [i, f] of images.entries()) {
    const name = f.name || "dan-tu-clipboard.png";
    setBusy(`Đang detect ${images.length > 1 ? `${i + 1}/${images.length} · ` : ""}${name}…`);
    try {
      const qs = new URLSearchParams({ version: els.version.value, filename: name });
      const rec = await api(`/api/detections?${qs}`, { method: "POST", body: f, headers: { "Content-Type": f.type || "application/octet-stream" } });
      lastId = rec.id;
      await loadHistory();
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  setBusy("");
  if (errors.length) showNotice(errors.join("\n"));
  if (lastId) await show(lastId);
}

// ---------- Sự kiện ----------
els.drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.file.click(); } });
els.file.addEventListener("change", () => { upload(els.file.files); els.file.value = ""; });

// Kéo file vào bất kỳ đâu trên trang đều được; hiện lớp phủ để biết có thể thả.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
window.addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; els.veil.hidden = false; } });
window.addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; els.veil.hidden = true; } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.veil.hidden = true;
  if (e.dataTransfer?.files.length) upload(e.dataTransfer.files);
});
window.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) upload(files);
});

els.tabs.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  state.tab = b.dataset.tab;
  renderViewer();
});
els.showQuad.addEventListener("change", renderViewer);
els.showLines.addEventListener("change", renderViewer);
els.zoom.addEventListener("click", openLightbox);
els.canvas.addEventListener("click", (e) => { if (e.target.closest(".frame")) openLightbox(); });
els.lightbox.addEventListener("click", closeLightbox);
els.lbClose.addEventListener("click", closeLightbox);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.lightbox.hidden) { closeLightbox(); return; }
  if (e.key === "Escape") closeDrawer();
  if (!["ArrowLeft", "ArrowRight"].includes(e.key) || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
  // Mũi tên trái/phải để duyệt lịch sử (ảnh mới hơn nằm bên trái).
  const i = state.items.findIndex((x) => x.id === state.current?.id);
  const next = state.items[i + (e.key === "ArrowRight" ? 1 : -1)];
  if (next) show(next.id);
});

(async function init() {
  try {
    await loadDetectors();
    await loadHistory();
    const id = location.hash.slice(1);
    const target = state.items.find((i) => i.id === id) || state.items[0];
    if (target) await show(target.id, { push: !!id });
    else renderViewer();
  } catch (e) {
    showNotice(`Không kết nối được server: ${e.message}`);
  }
})();
