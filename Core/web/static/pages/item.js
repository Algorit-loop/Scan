// Trang một ảnh: /d/<tên>/i/<id>?run=..&vs=..&filter=..  (giữ bộ lọc của danh sách để bấm ảnh trước/sau)
// Đáp án + dự đoán của mọi phiên bản đã chạy, chồng lớp hoặc đặt cạnh nhau, detect lại bằng code hiện tại.

import { COLORS, EXTRA_COLORS, SIZES, api, cornersToList, esc, fmt, href, iouBadge, quadIoU, shot, store, typing } from "../lib.js";
import { PER_PAGE, defaultRun } from "./dataset.js";

const LIST_KEYS = ["run", "vs", "filter", "group", "sort", "q"];

export default async function item(main, ctx) {
  const [ds, id] = ctx.params;
  const info = ctx.meta.datasets.find((d) => d.name === ds);
  if (!info) throw new Error(`Không có bộ dữ liệu "${ds}"`);

  const list = {};
  for (const k of LIST_KEYS) if (ctx.q.get(k)) list[k] = ctx.q.get(k);
  if (!list.run) list.run = defaultRun(info.runs, info.images) || undefined;
  const dsBase = `/d/${encodeURIComponent(ds)}`;
  const itemUrl = (other) => href(`${dsBase}/i/${encodeURIComponent(other)}`, list, { filter: "all", sort: "id" });

  const data = await api(href(`/api/datasets/${encodeURIComponent(ds)}/items/${encodeURIComponent(id)}`, list));
  if (ctx.stale()) return;
  const { label, runs, nav } = data;
  const W = label.width, H = label.height;
  const backUrl = href(dsBase, { ...list, page: nav.index >= 0 ? String(Math.floor(nav.index / PER_PAGE) + 1) : "1" }, { filter: "all", sort: "id", page: "1" }) + "#browse";

  // Thứ tự lớp: run (A), vs (B), rồi các lượt khác.
  const order = Object.keys(runs).sort((a, b) => (a === list.run ? -2 : a === list.vs ? -1 : 0) - (b === list.run ? -2 : b === list.vs ? -1 : 0) || a.localeCompare(b));
  let extra = 0;
  const color = {};
  for (const r of order) color[r] = r === list.run ? COLORS.a : r === list.vs ? COLORS.b : EXTRA_COLORS[extra++ % EXTRA_COLORS.length];

  // Trạng thái hiển thị (giữ khi bấm ảnh trước/sau trong cùng tab).
  const saved = store("item:view") || {};
  const view = {
    mode: saved.mode || "overlay",
    gt: saved.gt ?? true,
    lines: saved.lines ?? true,
    on: new Set(order.filter((r) => r === list.run || r === list.vs)),
  };
  let live = null; // kết quả "Detect lại"

  const save = () => store("item:view", { mode: view.mode, gt: view.gt, lines: view.lines });
  const gtLayer = () => (view.gt && label.found ? { pts: label.corners, color: COLORS.gt, width: 2.5 } : null);
  const runLayer = (r) => {
    const p = runs[r];
    return p?.pred ? { pts: p.pred, color: color[r], width: 2, dots: true, dash: r === list.vs } : null;
  };
  const liveLayer = () => (live?.result.found ? { pts: cornersToList(live.result.corners), color: COLORS.live, width: 2, dots: true } : null);
  const imgSrc = `/api/datasets/${encodeURIComponent(ds)}/images/${encodeURIComponent(id)}`;

  function stage() {
    const visible = order.filter((r) => view.on.has(r));
    const liveOn = live && view.on.has("live");
    const lines = liveOn && view.lines ? live.result.debug?.lines : null;
    if (view.mode === "split") {
      const panes = visible.map((r) => ({ t: r, c: color[r], layers: [gtLayer(), runLayer(r)], p: runs[r] }));
      if (liveOn) panes.push({ t: `Detect lại · ${live.version}@${live.size}`, c: COLORS.live, layers: [gtLayer(), liveLayer()], lines });
      if (!panes.length) panes.push({ t: "Đáp án", c: COLORS.gt, layers: [gtLayer()] });
      return `<div class="stage split">${panes.map((p) => `<div class="pane"><div class="pane-t"><span class="dot" style="--c:${p.c}"></span><b class="mono">${esc(p.t)}</b>${p.p ? iouBadge(p.p, label.found) : ""}</div>${shot({ src: imgSrc, w: W, h: H, layers: p.layers, lines: p.lines, lazy: false })}</div>`).join("")}</div>`;
    }
    const layers = [gtLayer(), ...visible.reverse().map(runLayer), liveOn ? liveLayer() : null];
    return `<div class="stage">${shot({ src: imgSrc, w: W, h: H, layers, lines, lazy: false })}</div>`;
  }

  function runsTable() {
    const row = (key, name, tag, p, c) => `<tr>
      <td><input type="checkbox" data-layer="${esc(key)}"${(key === "gt" ? view.gt : view.on.has(key)) ? " checked" : ""} aria-label="Hiện ${esc(name)}"></td>
      <td><span style="display:inline-flex;gap:6px;align-items:center"><span class="dot" style="--c:${c}"></span><span class="mono">${esc(name)}</span>${tag ? `<span class="tag">${tag}</span>` : ""}</span></td>
      <td class="num">${p ? iouBadge(p, label.found) : label.found ? `<span class="badge">có tài liệu</span>` : `<span class="badge">không có</span>`}</td>
      <td class="num" title="${p ? esc(`Phương pháp: ${p.method ?? "—"} · Độ tin cậy: ${p.confidence ?? "—"}`) : ""}">${p ? fmt.pct(p.cornerErr, 2) : ""}</td>
      <td class="num">${p ? fmt.ms(p.ms) : ""}</td></tr>`;
    const rows = [row("gt", "Đáp án", "", null, COLORS.gt)];
    for (const r of order) rows.push(row(r, r, r === list.run ? "A" : r === list.vs ? "B" : "", runs[r], color[r]));
    if (live) {
      const p = { found: live.result.found, iou: live.iou, cornerErr: null, ms: live.ms, method: live.result.method, confidence: live.result.confidence };
      rows.push(row("live", `${live.version}@${live.size}`, "LIVE", p, COLORS.live));
    }
    return `<table class="table layer-t"><thead><tr><th></th><th>Lớp</th><th class="num">IoU</th><th class="num">Lệch góc</th><th class="num">Thời gian</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  function labelInfo() {
    const skip = new Set(["id", "image", "width", "height", "corners", "found"]);
    const extraKv = Object.entries(label).filter(([k]) => !skip.has(k)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
    const a = runs[list.run];
    return `<dl class="kv">
      <dt>Kích thước</dt><dd>${W} × ${H}</dd>
      <dt>Có tài liệu</dt><dd>${label.found ? "có" : "không"}</dd>
      ${extraKv}
      ${a ? `<dt>Phương pháp (A)</dt><dd>${esc(a.method ?? "—")}</dd><dt>Độ tin cậy (A)</dt><dd>${a.confidence ?? "—"}</dd>` : ""}
    </dl>`;
  }

  function liveBox() {
    const dets = ctx.meta.detectors;
    const lastV = store("live:v") || list.run?.split("@")[0] || dets[0]?.version;
    const lastS = store("live:s") || +(list.run?.split("@")[1]) || ctx.meta.letterbox;
    const r = live?.result;
    const detail = r ? `<dl class="kv" style="margin-top:12px">
        <dt>Kết quả</dt><dd>${r.found ? `tìm thấy · ${esc(r.method)}` : `không thấy (${esc(r.reason)})`}</dd>
        ${live.iou != null ? `<dt>IoU</dt><dd>${fmt.iou(live.iou)}</dd>` : ""}
        ${r.found ? `<dt>Độ tin cậy</dt><dd>${r.confidence.toFixed(3)}</dd>` : ""}
        <dt>Thời gian</dt><dd>${fmt.ms(live.ms)}</dd>
        ${r.debug?.score != null ? `<dt>Điểm</dt><dd>${r.debug.score}</dd>` : r.debug?.bestScore != null ? `<dt>Điểm cao nhất</dt><dd>${r.debug.bestScore}</dd>` : ""}
        ${r.debug?.candidates != null ? `<dt>Ứng viên</dt><dd>${r.debug.candidates}</dd>` : ""}
        ${r.debug?.lines ? `<dt>Đường thẳng</dt><dd><label><input type="checkbox" id="optLines"${view.lines ? " checked" : ""}> hiện ${r.debug.lines.length}</label></dd>` : ""}
      </dl>` : "";
    return `<div style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="select" id="lvV" aria-label="Phiên bản">${dets.map((d) => `<option value="${esc(d.version)}"${d.version === lastV ? " selected" : ""}>${esc(d.version)}</option>`).join("")}</select>
        <select class="select" id="lvS" aria-label="Letterbox">${[...new Set([...SIZES, lastS])].sort((a, b) => a - b).map((s) => `<option${s === lastS ? " selected" : ""}>${s}</option>`).join("")}</select>
        <button class="btn primary" id="lvGo" type="button">Detect lại</button>
      </div>${detail}`;
  }

  function render() {
    main.innerHTML = `
      <div class="page-head" style="align-items:center">
        <nav class="crumb"><a href="${esc(backUrl)}">${esc(ds)}</a><span>/</span><b title="${esc(id)}">${esc(id)}</b></nav>
        <div class="stepper">
          ${nav.prev ? `<a class="btn sm" href="${esc(itemUrl(nav.prev))}" title="Ảnh trước (←)">‹ Trước</a>` : `<span class="btn sm" aria-disabled="true" style="opacity:.4">‹ Trước</span>`}
          <span class="pos">${nav.index >= 0 ? `${fmt.int(nav.index + 1)} / ${fmt.int(nav.total)}` : "ngoài bộ lọc"}</span>
          ${nav.next ? `<a class="btn sm" href="${esc(itemUrl(nav.next))}" title="Ảnh sau (→)">Sau ›</a>` : `<span class="btn sm" aria-disabled="true" style="opacity:.4">Sau ›</span>`}
          <a class="btn sm" href="${esc(backUrl)}" title="Về danh sách (Esc)">Danh sách</a>
        </div>
      </div>
      <div class="inspect">
        <div class="card viewer">
          <div class="vt">
            <div class="chips">
              <a class="chip${view.mode === "overlay" ? " on" : ""}" data-mode="overlay" href="#" role="button">Chồng lớp</a>
              <a class="chip${view.mode === "split" ? " on" : ""}" data-mode="split" href="#" role="button">Cạnh nhau</a>
            </div>
            <div class="hint"><span><span class="kbd">←</span> <span class="kbd">→</span> ảnh trước/sau</span><span><span class="kbd">S</span> đổi chế độ</span><span><span class="kbd">G</span> đáp án</span><span><span class="kbd">Esc</span> danh sách</span>
              <a href="${esc(imgSrc)}" target="_blank" rel="noopener" style="color:var(--accent)">Mở ảnh gốc ↗</a></div>
          </div>
          ${stage()}
        </div>
        <aside class="side">
          <div class="card"><div class="card-h"><h2>Kết quả</h2><span class="muted">bật/tắt lớp vẽ</span></div>${runsTable()}</div>
          <div class="card"><div class="card-h"><h2>Detect lại</h2><span class="muted">code hiện tại</span></div><div class="card-b">${liveBox()}</div></div>
          <div class="card"><div class="card-h"><h2>Ảnh</h2></div><div class="card-b">${labelInfo()}</div></div>
        </aside>
      </div>`;
  }

  render();

  const onClick = async (e) => {
    const m = e.target.closest("[data-mode]");
    if (m) { e.preventDefault(); view.mode = m.dataset.mode; save(); render(); return; }
    if (e.target.id === "lvGo") {
      const version = main.querySelector("#lvV").value, size = +main.querySelector("#lvS").value;
      store("live:v", version); store("live:s", size);
      e.target.disabled = true; e.target.textContent = "Đang detect…";
      try {
        const res = await api(href(`/api/datasets/${encodeURIComponent(ds)}/items/${encodeURIComponent(id)}/detect`, { version, size }), { method: "POST" });
        if (ctx.stale()) return;
        live = res;
        live.iou = label.found && res.result.found ? quadIoU(cornersToList(res.result.corners), label.corners, W, H) : label.found ? 0 : null;
        view.on.add("live");
      } catch (err) {
        alert(err.message);
      }
      render();
    }
  };
  const onChange = (e) => {
    const k = e.target.dataset?.layer;
    if (k === "gt") { view.gt = e.target.checked; save(); }
    else if (k) { if (e.target.checked) view.on.add(k); else view.on.delete(k); }
    else if (e.target.id === "optLines") { view.lines = e.target.checked; save(); }
    else return;
    render();
  };
  const onKey = (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowLeft" && nav.prev) ctx.navigate(itemUrl(nav.prev), { replace: true });
    else if (e.key === "ArrowRight" && nav.next) ctx.navigate(itemUrl(nav.next), { replace: true });
    else if (e.key === "Escape") ctx.navigate(backUrl);
    else if (e.key === "s" || e.key === "S") { view.mode = view.mode === "split" ? "overlay" : "split"; save(); render(); }
    else if (e.key === "g" || e.key === "G") { view.gt = !view.gt; save(); render(); }
    else return;
    e.preventDefault();
  };
  main.addEventListener("click", onClick);
  main.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  // Tải sẵn ảnh kế tiếp để bấm → không phải chờ.
  if (nav.next) new Image().src = `/api/datasets/${encodeURIComponent(ds)}/images/${encodeURIComponent(nav.next)}`;
  return () => {
    main.removeEventListener("click", onClick);
    main.removeEventListener("change", onChange);
    document.removeEventListener("keydown", onKey);
  };
}
