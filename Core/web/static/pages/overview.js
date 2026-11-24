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
    { k: "msMedian", t: "ms", f: (v) => (v == null ? "n/a" : v.toFixed(v < 10 ? 1 : 0)), best: Math.min },
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
        return `<td class="num first-of-ds muted" colspan="${cols.length}" style="text-align:center"><a href="${esc(href("/eval", { version, size, ds: d.name }))}" title="Chạy đánh giá ${esc(run)} trên ${esc(d.name)}">chưa chạy, bấm để chạy</a></td>`;
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
      <div class="facts"><span><b>${d.runs.length}</b> lượt đánh giá</span></div>
      ${d.runs.length ? `<div class="runs">${d.runs.map((r) => `<span>${esc(r.run)}</span>`).join("")}</div>` : ""}
    </a>`;
  }).join("");

  const totalImages = datasets.reduce((n, d) => n + d.images, 0);
  const totalRuns = datasets.reduce((n, d) => n + d.runs.length, 0);
  main.innerHTML = `
    <header class="page-hero hero-blue">
      <div><h1>Tổng quan</h1>
        <p>Mỗi phiên bản detect đã được chạy trên những bộ dữ liệu nào và đạt bao nhiêu. Bấm một ô trong bảng để xem từng ảnh của lượt chạy đó.</p>
        <div class="facts"><span class="fact"><b>${datasets.length}</b> bộ dữ liệu</span><span class="fact"><b>${fmt.int(totalImages)}</b> ảnh có nhãn</span><span class="fact"><b>${runNames.length}</b> cấu hình</span><span class="fact"><b>${totalRuns}</b> lượt đánh giá</span></div></div>
      <div class="actions"><a class="btn primary" href="/eval">Chạy đánh giá mới</a></div>
    </header>
    ${runNames.length ? `
    <div class="card scroll">
      <table class="table board">
        <thead><tr><th rowspan="2">Phiên bản @ letterbox</th>${head1}</tr><tr>${head2}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="explain">
      <div style="--k:var(--c-blue)"><b>Mean IoU</b>Độ trùng trung bình giữa khung tìm được và nhãn đúng. 1 là trùng khít, 0 là không trùng hoặc không thấy.</div>
      <div style="--k:var(--c-green)"><b>Success</b>Tỉ lệ ảnh có IoU từ 0,9 trở lên, tức khung đủ chuẩn để nắn phẳng dùng được.</div>
      <div style="--k:var(--c-amber)"><b>ms</b>Thời gian detect trung vị cho một ảnh trên máy này. Thấp hơn là nhanh hơn.</div>
      <div style="--k:var(--c-violet)"><b>★ tốt nhất cột</b>Chỉ so các lượt chạy đủ cả bộ dữ liệu, để không so hai tập ảnh khác nhau.</div>
    </div>`
    : `<div class="card empty">Chưa có kết quả đánh giá nào. <a href="/eval" style="color:var(--accent)">Chạy đánh giá</a></div>`}
    <h2 class="sec-title" style="--c:var(--c-teal)">Bộ dữ liệu</h2>
    <div class="ds-cards" style="margin-top:0">${cards}</div>`;
}
