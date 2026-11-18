// Trang tổng quan: bảng chỉ số mọi phiên bản × bộ dữ liệu. Mỗi ô là link tới trang bộ dữ liệu với phiên bản đó.

import { esc, fmt, href } from "../lib.js";

export default async function overview(main, ctx) {
  await ctx.refreshMeta(); // luôn lấy kết quả mới nhất khi mở tổng quan
  const { datasets } = ctx.meta;
  const runNames = [...new Set(datasets.flatMap((d) => d.runs.map((r) => r.run)))].sort((a, b) => {
    const [va, sa] = a.split("@"), [vb, sb] = b.split("@");
    return va.localeCompare(vb) || (+sa || 0) - (+sb || 0);
  });
  const cols = [
    { k: "meanIoU", t: "Mean IoU", f: fmt.iou, best: Math.max },
    { k: "success", t: "Success", f: (v) => fmt.pct(v, 0), best: Math.max },
    { k: "msMedian", t: "ms", f: (v) => (v == null ? "—" : v.toFixed(v < 10 ? 1 : 0)), best: Math.min },
  ];
  // Ô tốt nhất mỗi cột (chỉ xét lượt chạy trên toàn bộ dữ liệu, tránh so lệch tập ảnh).
  const best = {};
  for (const d of datasets) {
    for (const c of cols) {
      const vals = d.runs.filter((r) => r.summary.images >= d.images).map((r) => r.summary[c.k]).filter((v) => v != null);
      if (vals.length > 1) best[`${d.name}:${c.k}`] = c.best(...vals);
    }
  }

  const head1 = datasets.map((d) => `<th class="ds" colspan="${cols.length}"><a href="/d/${encodeURIComponent(d.name)}">${esc(d.name)}</a></th>`).join("");
  const head2 = datasets.map(() => cols.map((c, i) => `<th class="num${i === 0 ? " first-of-ds" : ""}">${c.t}</th>`).join("")).join("");
  const rows = runNames.map((run) => {
    const cells = datasets.map((d) => {
      const r = d.runs.find((x) => x.run === run);
      const link = href(`/d/${encodeURIComponent(d.name)}`, { run });
      if (!r) {
        const [version, size] = run.split("@");
        return `<td class="num first-of-ds muted" colspan="${cols.length}" style="text-align:center"><a href="${esc(href("/eval", { version, size, ds: d.name }))}" title="Chạy đánh giá ${esc(run)} trên ${esc(d.name)}">— chưa chạy</a></td>`;
      }
      const partial = r.summary.images < d.images;
      return cols.map((c, i) => {
        const v = r.summary[c.k];
        const isBest = !partial && v != null && best[`${d.name}:${c.k}`] === v;
        const sub = i === 0 && partial ? `<span class="partial">${fmt.int(r.summary.images)}/${fmt.int(d.images)} ảnh</span>` : "";
        return `<td class="num cell${i === 0 ? " first-of-ds" : ""}${isBest ? " best" : ""}"><a href="${esc(link)}"><span class="v">${c.f(v)}</span>${sub}</a></td>`;
      }).join("");
    }).join("");
    return `<tr><td><b class="mono">${esc(run)}</b></td>${cells}</tr>`;
  }).join("");

  const cards = datasets.map((d) => {
    const neg = d.images - d.positives;
    return `<a class="card ds-card" href="/d/${encodeURIComponent(d.name)}">
      <h2>${esc(d.name)}</h2>
      <div class="facts"><span><b>${fmt.int(d.images)}</b> ảnh</span><span><b>${fmt.int(neg)}</b> không có tài liệu</span><span><b>${d.groups.length}</b> nhóm</span></div>
      <div class="facts"><span><b>${d.runs.length}</b> lượt đánh giá</span>${d.runs.length ? `<span class="mono">${d.runs.map((r) => esc(r.run)).join(" · ")}</span>` : ""}</div>
    </a>`;
  }).join("");

  main.innerHTML = `
    <div class="page-head">
      <div><h1>Tổng quan</h1><p>Chỉ số của mọi phiên bản detect trên từng bộ dữ liệu. Bấm một ô để mở chi tiết.</p></div>
      <a class="btn" href="/eval">Chạy đánh giá mới</a>
    </div>
    ${runNames.length ? `
    <div class="card scroll">
      <table class="table board">
        <thead><tr><th rowspan="2">Phiên bản @ letterbox</th>${head1}</tr><tr>${head2}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted" style="font-size:12.5px;margin:8px 2px 0">★ tốt nhất cột (chỉ so các lượt chạy đủ bộ dữ liệu). Success = tỉ lệ ảnh có IoU ≥ 0.9. ms = thời gian detect trung vị.</p>`
    : `<div class="card empty">Chưa có kết quả đánh giá nào. <a href="/eval" style="color:var(--accent)">Chạy đánh giá</a></div>`}
    <div class="ds-cards">${cards}</div>`;
}
