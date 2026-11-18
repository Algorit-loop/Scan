// Thử ảnh bất kỳ: /try (upload), /try/<id> (xem lại một lần thử). Dán (Ctrl+V), kéo thả hoặc chọn file.

import { COLORS, SIZES, api, cornersToList, esc, fmt, href, shot, store, toast } from "../lib.js";

export default async function tryPage(main, ctx) {
  const id = ctx.params[0] || null;
  const [list, rec] = await Promise.all([api("/api/try"), id ? api(`/api/try/${encodeURIComponent(id)}`) : null]);
  if (ctx.stale()) return;

  const dets = ctx.meta.detectors;
  const requested = ctx.q.get("version") || store("try:v");
  let version = dets.some((d) => d.version === requested) ? requested : dets.find((d) => d.default)?.version || dets[0]?.version;
  let size = store("try:s") || ctx.meta.letterbox;
  let showLines = store("try:lines") ?? false;

  const historyHtml = list.length ? list.map((r) => `
    <a href="/try/${encodeURIComponent(r.id)}" class="${r.id === id ? "on" : ""}">
      <img src="/api/try/${encodeURIComponent(r.id)}/files/thumb" alt="" loading="lazy">
      <div style="min-width:0"><div class="t" title="${esc(r.filename)}">${esc(r.filename)}</div>
      <div class="s">${r.found ? `<span class="badge good">thấy</span>` : `<span class="badge bad">không thấy</span>`}<span class="mono">${esc(r.version)}${r.size ? `@${r.size}` : ""}</span><span>${fmt.date(r.createdAt)}</span></div></div>
    </a>`).join("") : `<div class="empty" style="padding:20px">Chưa có ảnh nào.</div>`;

  function detail() {
    if (!rec) {
      return `<label class="drop big" id="dropBig"><b>Dán ảnh (Ctrl+V), kéo thả, hoặc bấm để chọn</b><small>JPG, PNG, WebP · nhiều ảnh cùng lúc · tối đa 40 MB/ảnh</small></label>`;
    }
    const r = rec.result;
    const [W, H] = rec.imageSize;
    const layers = r.found ? [{ pts: cornersToList(r.corners), color: COLORS.a, width: 2.5, dots: true, fill: true }] : [];
    const lines = showLines ? r.debug?.lines : null;
    const src = `/api/try/${encodeURIComponent(rec.id)}/files/original`;
    return `
      <div class="page-head" style="margin-bottom:12px;align-items:center">
        <div style="min-width:0"><h1 style="font-size:18px;overflow-wrap:anywhere">${esc(rec.filename)}</h1><p>${fmt.date(rec.createdAt)} · <span class="mono">${esc(rec.version)}${rec.size ? `@${rec.size}` : ""}</span></p></div>
        <div style="display:flex;gap:8px">
          ${r.debug?.lines ? `<label class="chip${showLines ? " on" : ""}"><input type="checkbox" id="optLines"${showLines ? " checked" : ""}>Đường thẳng (${r.debug.lines.length})</label>` : ""}
          <a class="btn" href="${esc(src)}" target="_blank" rel="noopener">Ảnh gốc ↗</a>
          <button class="btn danger" id="del" type="button">Xóa</button>
        </div>
      </div>
      <div class="try-view">
        <div class="card viewer"><div class="stage">${shot({ src, w: W, h: H, layers, lines, lazy: false, badge: r.found ? "" : `<span class="badge bad">Không tìm thấy (${esc(r.reason)})</span>` })}</div></div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${rec.files.warped ? `<div class="card"><div class="card-h"><h2>Nắn phẳng</h2></div><div class="warped"><img src="/api/try/${encodeURIComponent(rec.id)}/files/warped" alt="Tài liệu đã nắn phẳng"></div></div>` : ""}
          <div class="card"><div class="card-h"><h2>Kết quả</h2></div><div class="card-b"><dl class="kv">
            <dt>Kết quả</dt><dd>${r.found ? `tìm thấy · ${esc(r.method)}` : `không thấy (${esc(r.reason)})`}</dd>
            ${r.found ? `<dt>Độ tin cậy</dt><dd>${r.confidence.toFixed(3)}</dd><dt>Diện tích</dt><dd>${fmt.pct(r.areaRatio)}</dd>` : ""}
            <dt>Detect</dt><dd>${fmt.ms(rec.timingsMs.detect)}</dd>
            <dt>Đọc ảnh</dt><dd>${fmt.ms(rec.timingsMs.decode)}</dd>
            <dt>Kích thước</dt><dd>${W} × ${H}</dd>
            <dt>Dung lượng</dt><dd>${(rec.bytes / 1024).toFixed(0)} KB</dd>
            ${r.debug?.score != null ? `<dt>Điểm</dt><dd>${r.debug.score}</dd>` : ""}
            ${r.debug?.bestScore != null ? `<dt>Điểm cao nhất</dt><dd>${r.debug.bestScore}</dd>` : ""}
            ${r.debug?.candidates != null ? `<dt>Ứng viên</dt><dd>${r.debug.candidates}</dd>` : ""}
          </dl></div></div>
        </div>
      </div>`;
  }

  function render() {
    main.innerHTML = `
      <div class="try">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div class="card"><div class="card-b" style="display:flex;flex-direction:column;gap:12px">
            <div class="field"><span class="label">Phiên bản</span><div class="chips">${dets.map((d) => `<label class="chip${d.version === version ? " on" : ""}" title="${esc(d.name)}"><input type="radio" name="tv" value="${esc(d.version)}"${d.version === version ? " checked" : ""}>${esc(d.version)}</label>`).join("")}</div></div>
            <div class="field"><span class="label">Letterbox</span><div class="chips">${SIZES.map((s) => `<label class="chip${s === size ? " on" : ""}"><input type="radio" name="ts" value="${s}"${s === size ? " checked" : ""}>${s}</label>`).join("")}</div></div>
            <label class="drop" id="drop"><input type="file" id="file" accept="image/*" multiple hidden><b>+ Thêm ảnh</b><small>hoặc dán / kéo thả vào trang</small></label>
          </div></div>
          <div class="card"><div class="card-h"><h2>Đã thử</h2><span class="muted">${list.length}</span></div><div class="hist-list">${historyHtml}</div></div>
        </div>
        <div>${detail()}</div>
      </div>`;
    const input = main.querySelector("#file");
    main.querySelectorAll("#drop, #dropBig").forEach((el) => el.addEventListener("click", (e) => { if (e.target !== input) { e.preventDefault(); input.click(); } }));
    input.addEventListener("change", () => upload([...input.files]));
  }

  let busy = false;
  async function upload(files) {
    files = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name));
    if (!files.length || busy) return;
    busy = true;
    let last = null;
    try {
      for (const [i, f] of files.entries()) {
        toast(`Đang detect ${i + 1}/${files.length}: ${f.name}`, 60000);
        last = await api(href("/api/try", { version, size, filename: f.name || "clipboard.png" }), { method: "POST", body: f });
      }
      toast(files.length > 1 ? `Xong ${files.length} ảnh` : "Xong");
    } catch (e) {
      toast(`Lỗi: ${e.message}`, 6000);
    } finally {
      busy = false;
    }
    if (last && !ctx.stale()) ctx.navigate(`/try/${encodeURIComponent(last.id)}`);
  }

  render();

  const onChange = (e) => {
    if (e.target.name === "tv") { version = e.target.value; store("try:v", version); render(); }
    else if (e.target.name === "ts") { size = +e.target.value; store("try:s", size); render(); }
    else if (e.target.id === "optLines") { showLines = e.target.checked; store("try:lines", showLines); render(); }
  };
  const onClick = async (e) => {
    if (e.target.id !== "del" || !rec) return;
    if (!confirm(`Xóa "${rec.filename}"?`)) return;
    try {
      await api(`/api/try/${encodeURIComponent(rec.id)}`, { method: "DELETE" });
      const idx = list.findIndex((r) => r.id === rec.id);
      const next = list[idx + 1] || list[idx - 1];
      ctx.navigate(next ? `/try/${encodeURIComponent(next.id)}` : "/try", { replace: true });
    } catch (err) { toast(err.message); }
  };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); upload(files); }
  };
  let veil = null;
  const onDragOver = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    if (!veil) { veil = document.createElement("div"); veil.className = "veil"; veil.textContent = "Thả ảnh để detect"; document.body.append(veil); }
  };
  const hideVeil = () => { veil?.remove(); veil = null; };
  const onDragLeave = (e) => { if (!e.relatedTarget) hideVeil(); };
  const onDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    hideVeil();
    upload([...e.dataTransfer.files]);
  };
  main.addEventListener("change", onChange);
  main.addEventListener("click", onClick);
  document.addEventListener("paste", onPaste);
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  return () => {
    hideVeil();
    main.removeEventListener("change", onChange);
    main.removeEventListener("click", onClick);
    document.removeEventListener("paste", onPaste);
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
  };
}
