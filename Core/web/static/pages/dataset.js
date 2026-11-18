// Trang một bộ dữ liệu: /d/<tên>?run=..&vs=..&filter=..&group=..&sort=..&q=..&page=..
// Chọn phiên bản (run) và phiên bản so sánh (vs); chỉ số, phân bố IoU, theo nhóm, lưới ảnh có lọc.

import { COLORS, api, deltaBadge, esc, fmt, href, iouBadge, shot, store } from "../lib.js";

export const PER_PAGE = 60;
let refocusSearch = false; // gõ tìm kiếm -> trang vẽ lại -> trả con trỏ về ô tìm
const DEFAULTS = { filter: "all", sort: "id", page: "1" };

export function defaultRun(runs, total) {
  if (!runs.length) return null;
  // Ưu tiên lượt chạy đủ bộ dữ liệu, mới nhất.
  return [...runs].sort((a, b) =>
    (b.summary.images >= total) - (a.summary.images >= total) || String(b.createdAt).localeCompare(String(a.createdAt)))[0].run;
}

export default async function dataset(main, ctx) {
  const ds = ctx.params[0];
  const info = ctx.meta.datasets.find((d) => d.name === ds);
  if (!info) throw new Error(`Không có bộ dữ liệu "${ds}"`);
  const runs = info.runs;
  const q = ctx.q;

  let run = q.get("run");
  if (!runs.some((r) => r.run === run)) run = defaultRun(runs, info.images);
  let vs = q.get("vs");
  if (vs === run || !runs.some((r) => r.run === vs)) vs = null;
  const st = {
    run, vs,
    filter: q.get("filter") || "all",
    group: q.get("group") || "",
    sort: q.get("sort") || "id",
    q: q.get("q") || "",
    page: Math.max(1, parseInt(q.get("page") || "1", 10) || 1),
  };
  if (!vs && (st.filter === "better" || st.filter === "worse")) st.filter = "all";
  if (!vs && st.sort.includes("delta")) st.sort = "id";

  const base = `/d/${encodeURIComponent(ds)}`;
  const link = (patch = {}) => {
    const next = { ...st, ...patch };
    if (!("page" in patch)) next.page = 1; // đổi bộ lọc thì về trang 1
    return href(base, { ...next, page: String(next.page) }, DEFAULTS);
  };
  const canonical = link({ page: st.page });
  if (canonical !== location.pathname + location.search) history.replaceState(null, "", canonical + location.hash);
  store(`ds:${ds}`, location.search);

  const listQuery = { run: st.run, vs: st.vs, filter: st.filter, group: st.group, sort: st.sort, q: st.q };
  const [stats, items, full] = await Promise.all([
    st.run ? api(href(`/api/datasets/${encodeURIComponent(ds)}/stats`, { run: st.run, vs: st.vs })) : null,
    api(href(`/api/datasets/${encodeURIComponent(ds)}/items`, { ...listQuery, offset: (st.page - 1) * PER_PAGE, limit: PER_PAGE })),
    api(`/api/datasets/${encodeURIComponent(ds)}`),
  ]);
  if (ctx.stale()) return;

  const runInfo = (name) => runs.find((r) => r.run === name);
  const hasNeg = info.images > info.positives;

  // ---------------- chọn phiên bản ----------------
  const chipRun = (r) => `<a class="chip${r.run === st.run ? " on ca" : ""}" href="${esc(link({ run: r.run, vs: st.vs === r.run ? null : st.vs }))}" title="${esc(`${r.detector || ""} · ${fmt.date(r.createdAt)}`)}"><span class="dot" style="--c:${COLORS.a}"></span><span class="mono">${esc(r.run)}</span><span class="count">${fmt.int(r.summary.images)}</span></a>`;
  const chipVs = (r) => `<a class="chip${r.run === st.vs ? " on cb" : ""}" href="${esc(link({ vs: r.run }))}" title="${esc(fmt.date(r.createdAt))}"><span class="dot" style="--c:${COLORS.b}"></span><span class="mono">${esc(r.run)}</span></a>`;
  const others = runs.filter((r) => r.run !== st.run);
  const runbar = runs.length ? `
    <div class="card runbar">
      <span class="label">Phiên bản</span>
      <div class="chips">${runs.map(chipRun).join("")}</div>
      <span class="label">So với</span>
      <div class="chips">
        <a class="chip${!st.vs ? " on" : ""}" href="${esc(link({ vs: null }))}">Không so sánh</a>
        ${others.map(chipVs).join("")}
        ${st.vs ? `<a class="btn sm" href="${esc(link({ run: st.vs, vs: st.run }))}" title="Đổi vai trò 2 phiên bản">⇄ Đổi chỗ</a>` : ""}
      </div>
      ${stats?.partial || (st.vs && stats && stats.images < runInfo(st.run).summary.images)
        ? `<div class="note">So sánh tính trên <b>${fmt.int(stats.images)}</b> ảnh có trong cả hai lượt chạy.</div>` : ""}
    </div>` : `
    <div class="alert info">Chưa có lượt đánh giá nào cho bộ này — đang hiển thị đáp án. <a href="${esc(href("/eval", { ds }))}" style="color:var(--accent);font-weight:600">Chạy đánh giá</a></div>`;

  // ---------------- chỉ số ----------------
  let metricsHtml = "";
  if (stats) {
    const A = stats.a, B = stats.b;
    const M = [
      { k: "meanIoU", t: "Mean IoU", f: fmt.iou, dir: 1, sub: (s) => `trung vị ${fmt.iou(s.medianIoU)}` },
      { k: "success", t: `Success @${stats.successIoU}`, f: (v) => fmt.pct(v), dir: 1, sub: (s) => `${fmt.int(Math.round((s.success ?? 0) * s.positives))}/${fmt.int(s.positives)} ảnh` },
      { k: "foundRate", t: "Tìm thấy", f: (v) => fmt.pct(v), dir: 1, sub: () => "trên ảnh có tài liệu" },
      { k: "cornerErr", t: "Lệch góc", f: (v) => fmt.pct(v, 2), dir: -1, sub: () => "TB / đường chéo ảnh" },
      ...(hasNeg ? [{ k: "falsePositive", t: "Báo nhầm", f: (v) => fmt.pct(v), dir: -1, sub: (s) => `trên ${fmt.int(s.negatives)} ảnh không có` }] : []),
      { k: "msMedian", t: "Thời gian", f: fmt.ms, dir: -1, sub: (s) => `p95 ${fmt.ms(s.msP95)} · ${s.fps ?? "—"} FPS` },
    ];
    metricsHtml = `<div class="metrics">${M.map((m) => {
      const a = A[m.k], b = B?.[m.k];
      let vsLine = `<div class="vs">${esc(m.sub(A))}</div>`;
      if (B) {
        const d = a != null && b != null ? a - b : null;
        const good = d != null && d * m.dir > 0;
        const dStr = d == null || Math.abs(d) < 1e-9 ? "±0" : fmt.signed(d, (x) => m.f(x).replace(/^[-−]/, ""));
        vsLine = `<div class="vs"><span class="dot" style="--c:${COLORS.b}"></span>${m.f(b)} <span class="d ${d ? (good ? "up" : "down") : ""}">${dStr}</span></div>`;
      }
      return `<div class="card metric"><div class="k"><span>${m.t}</span>${B ? `<span class="dot" style="--c:${COLORS.a}"></span>` : ""}</div><div class="v">${m.f(a)}</div>${vsLine}</div>`;
    }).join("")}</div>`;
  }

  // ---------------- phân bố IoU + theo nhóm ----------------
  let chartsHtml = "";
  if (stats && stats.a.histogram?.length) {
    const ha = stats.a.histogram, hb = stats.b?.histogram;
    const max = Math.max(1, ...ha, ...(hb || []));
    const bins = ha.map((n, i) => `<div class="bin" title="IoU ${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${n}${hb ? ` / ${hb[i]}` : ""} ảnh"><div class="bars"><div class="bar" style="height:${(n / max) * 100}%"></div>${hb ? `<div class="bar b" style="height:${(hb[i] / max) * 100}%"></div>` : ""}</div></div>`).join("");
    const groups = stats.groups.length > 1 ? stats.groups : [];
    const gRows = groups.map((g) => {
      const d = g.b && g.a.meanIoU != null && g.b.meanIoU != null ? g.a.meanIoU - g.b.meanIoU : null;
      return `<tr class="link${st.group === g.group ? " on" : ""}" data-href="${esc(link({ group: st.group === g.group ? "" : g.group }))}">
        <td>${esc(g.group)}</td><td class="num">${fmt.int(g.a.images)}</td>
        <td class="num">${iouBadge({ found: true, iou: g.a.meanIoU }, true)}</td>
        ${stats.b ? `<td class="num">${fmt.iou(g.b?.meanIoU)}</td><td class="num">${deltaBadge(d)}</td>` : ""}
        <td class="num">${fmt.pct(g.a.success, 0)}</td></tr>`;
    }).join("");
    chartsHtml = `<div class="two">
      <div class="card"><div class="card-h"><h2>Phân bố IoU</h2><div class="legend"><span><span class="dot" style="--c:${COLORS.a}"></span>${esc(st.run)}</span>${st.vs ? `<span><span class="dot" style="--c:${COLORS.b}"></span>${esc(st.vs)}</span>` : ""}</div></div>
        <div class="card-b"><div class="hist">${bins}</div><div class="hist-x">${ha.map((_, i) => `<span>${(i / 10).toFixed(1)}</span>`).join("")}</div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Chỉ ảnh có tài liệu. Cột cuối (0.9–1.0) càng cao càng tốt.</p></div></div>
      <div class="card"><div class="card-h"><h2>Theo nhóm</h2><span class="muted">${groups.length ? "Bấm một nhóm để lọc ảnh" : "Bộ này không chia nhóm"}</span></div>
        ${groups.length ? `<div class="scroll" style="max-height:290px"><table class="table"><thead><tr><th>Nhóm</th><th class="num">Ảnh</th><th class="num">IoU</th>${stats.b ? `<th class="num">IoU (so)</th><th class="num">Δ</th>` : ""}<th class="num">Success</th></tr></thead><tbody>${gRows}</tbody></table></div>` : ""}
      </div>
    </div>`;
  }

  // ---------------- thanh lọc + lưới ảnh ----------------
  const c = items.counts;
  const FILTERS = [
    ["all", "Tất cả", true],
    ["fail", "Lỗi (IoU < 0.9)", !!st.run],
    ["miss", "Không tìm thấy", !!st.run],
    ["ok", "Đạt", !!st.run],
    ["neg", "Không có tài liệu", hasNeg],
    ["fp", "Báo nhầm", hasNeg && !!st.run],
    ["better", "Tốt hơn", !!st.vs],
    ["worse", "Kém hơn", !!st.vs],
  ].filter((f) => f[2]);
  const chips = FILTERS.map(([k, t]) => `<a class="chip${st.filter === k ? " on" : ""}" href="${esc(link({ filter: k }))}">${t}<span class="count">${fmt.int(c[k])}</span></a>`).join("");
  const SORTS = [
    ["id", "Theo tên"],
    ...(st.run ? [["iou", "IoU thấp → cao"], ["-iou", "IoU cao → thấp"], ["-ms", "Chậm nhất trước"], ["conf", "Độ tin cậy thấp"]] : []),
    ...(st.vs ? [["delta", "Kém đi nhiều nhất"], ["-delta", "Tốt lên nhiều nhất"]] : []),
  ];
  const itemQuery = { ...listQuery };
  const tiles = items.items.map((it) => {
    const layers = [];
    if (it.gtFound) layers.push({ pts: it.gt, color: COLORS.gt, width: 2 });
    if (it.b?.pred) layers.push({ pts: it.b.pred, color: COLORS.b, width: 2, dash: true });
    if (it.a?.pred) layers.push({ pts: it.a.pred, color: COLORS.a, width: 2, dots: true });
    const badge = !it.gtFound ? `<span class="badge">Không có tài liệu</span>` : "";
    return `<a class="card tile" href="${esc(href(`${base}/i/${encodeURIComponent(it.id)}`, itemQuery, { filter: "all", sort: "id" }))}">
      <div class="frame">${shot({ src: `/api/datasets/${encodeURIComponent(ds)}/images/${encodeURIComponent(it.id)}?thumb=1`, w: it.w, h: it.h, layers, badge })}</div>
      <div class="meta">
        <div class="row"><span>${it.a ? iouBadge(it.a, it.gtFound) : ""} ${deltaBadge(it.delta)}</span><span class="muted num" style="font-size:12px">${it.a ? fmt.ms(it.a.ms) : ""}</span></div>
        <div class="id" title="${esc(it.id)}">${esc(it.id)}</div>
        ${it.group ? `<div class="grp">${esc(it.group)}</div>` : ""}
      </div></a>`;
  }).join("");

  const pages = Math.max(1, Math.ceil(items.total / PER_PAGE));
  const pg = (n, label = n) => `<a class="chip${n === st.page ? " on" : ""}" href="${esc(link({ page: n }))}#browse">${label}</a>`;
  let pager = "";
  if (pages > 1) {
    const nums = new Set([1, pages, st.page - 2, st.page - 1, st.page, st.page + 1, st.page + 2].filter((n) => n >= 1 && n <= pages));
    const arr = [...nums].sort((a, b) => a - b);
    const parts = [];
    arr.forEach((n, i) => { if (i && n - arr[i - 1] > 1) parts.push(`<span class="muted">…</span>`); parts.push(pg(n)); });
    pager = `<div class="pager">${st.page > 1 ? pg(st.page - 1, "‹ Trước") : ""}${parts.join("")}${st.page < pages ? pg(st.page + 1, "Sau ›") : ""}</div>`;
  }

  main.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(ds)}</h1><p>${fmt.int(info.images)} ảnh · ${fmt.int(info.images - info.positives)} không có tài liệu · ${info.groups.length} nhóm</p></div>
      <details class="card" style="max-width:640px;padding:8px 12px"><summary style="cursor:pointer;font-weight:500">Về bộ dữ liệu</summary><pre class="readme">${esc(full.readme || "Không có README.")}</pre></details>
    </div>
    ${runbar}
    ${metricsHtml}
    ${chartsHtml}
    <div id="browse" style="scroll-margin-top:52px"></div>
    <div class="toolbar">
      <div class="chips">${chips}</div>
      <span class="grow"></span>
      ${info.groups.length > 1 ? `<select class="select" id="fGroup" aria-label="Nhóm"><option value="">Mọi nhóm</option>${info.groups.map((g) => `<option${g === st.group ? " selected" : ""}>${esc(g)}</option>`).join("")}</select>` : ""}
      <select class="select" id="fSort" aria-label="Sắp xếp">${SORTS.map(([k, t]) => `<option value="${k}"${k === st.sort ? " selected" : ""}>${t}</option>`).join("")}</select>
      <input class="input" id="fQ" type="search" placeholder="Tìm theo tên ảnh  ( / )" value="${esc(st.q)}">
    </div>
    <div class="legend" style="margin:0 2px 12px">
      <span><span class="ln" style="--c:${COLORS.gt}"></span>Đáp án</span>
      ${st.run ? `<span><span class="ln" style="--c:${COLORS.a}"></span>${esc(st.run)}</span>` : ""}
      ${st.vs ? `<span><span class="ln dash" style="--c:${COLORS.b}"></span>${esc(st.vs)}</span>` : ""}
      <span class="grow"></span><span>${fmt.int(items.total)} ảnh${pages > 1 ? ` · trang ${st.page}/${pages}` : ""}</span>
    </div>
    ${items.items.length ? `<div class="grid">${tiles}</div>` : `<div class="card empty">Không có ảnh nào khớp bộ lọc.</div>`}
    ${pager}`;

  main.querySelector("#fGroup")?.addEventListener("change", (e) => ctx.navigate(link({ group: e.target.value })));
  main.querySelector("#fSort").addEventListener("change", (e) => ctx.navigate(link({ sort: e.target.value })));
  const fq = main.querySelector("#fQ");
  let timer = 0;
  fq.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { refocusSearch = true; ctx.navigate(link({ q: fq.value.trim() }), { replace: true }); }, 350);
  });
  if (refocusSearch) {
    refocusSearch = false;
    fq.focus();
    fq.setSelectionRange(fq.value.length, fq.value.length);
  }
  const onKey = (e) => {
    if (e.key === "/" && document.activeElement !== fq) { e.preventDefault(); fq.focus(); }
  };
  document.addEventListener("keydown", onKey);
  return () => { clearTimeout(timer); document.removeEventListener("keydown", onKey); };
}
