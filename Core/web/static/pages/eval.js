// Chạy đánh giá: /eval?version=..&size=..&ds=..  (tham số chỉ để điền sẵn form)
// Chạy tools/evaluate.py ở server, theo dõi tiến độ; xong thì kết quả hiện ngay ở các trang khác.

import { SIZES, api, esc, fmt, href, toast } from "../lib.js";

export default async function evalPage(main, ctx) {
  let status = await api("/api/eval/status");
  if (ctx.stale()) return;
  const dets = ctx.meta.detectors;
  const q = ctx.q;
  const form = {
    version: dets.some((d) => d.version === q.get("version")) ? q.get("version") : dets.find((d) => d.default)?.version || dets[0]?.version,
    size: +q.get("size") || ctx.meta.letterbox,
    datasets: new Set(q.getAll("ds").length ? q.getAll("ds") : ctx.meta.datasets.map((d) => d.name)),
    limit: q.get("limit") || "",
  };

  function statusHtml() {
    const s = status;
    if (!s.version) return `<div class="empty" style="padding:24px">Chưa chạy lượt nào kể từ khi bật server.</div>`;
    const all = [...(s.finished || []), ...(s.dataset && s.running ? [s.dataset] : []), ...(s.queue || [])];
    const rows = all.map((ds) => {
      const done = (s.finished || []).includes(ds);
      const cur = s.running && ds === s.dataset;
      const pct = done ? 100 : cur ? s.percent || 0 : 0;
      const note = done ? "xong" : cur ? `${fmt.int(s.done)}/${fmt.int(s.total)}${s.etaSeconds != null ? `, còn ${s.etaSeconds < 90 ? `${s.etaSeconds}s` : `${Math.round(s.etaSeconds / 60)} phút`}` : ""}` : "chờ";
      const link = href(`/d/${encodeURIComponent(ds)}`, { run: `${s.version}@${s.size}` });
      return `<div class="q"><span>${done ? `<a href="${esc(link)}" style="color:var(--accent)">${esc(ds)} →</a>` : esc(ds)}</span><div class="progress"><i style="width:${pct}%"></i></div><span class="muted num" style="text-align:right">${note}</span></div>`;
    }).join("");
    const head = s.running ? `Đang chạy <b class="mono">${esc(s.version)}@${esc(s.size)}</b>${s.limit ? `, ${s.limit} ảnh mỗi bộ` : ""}`
      : s.error ? `<span class="down">Lỗi</span>` : s.cancelled ? "Đã dừng" : `Xong <b class="mono">${esc(s.version)}@${esc(s.size)}</b>`;
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>${head}</span>${s.running ? `<button class="btn sm danger" id="cancel" type="button">Dừng</button>` : ""}</div>
      <div class="queue">${rows}</div>
      ${s.error ? `<div class="alert" style="margin:12px 0 0">${esc(s.error)}</div>` : ""}`;
  }

  function resultsHtml() {
    const rows = ctx.meta.datasets.flatMap((d) => d.runs.map((r) => ({ d, r })))
      .sort((x, y) => String(y.r.createdAt).localeCompare(String(x.r.createdAt)));
    if (!rows.length) return `<div class="empty">Chưa có kết quả.</div>`;
    return `<div class="scroll"><table class="table"><thead><tr><th>Phiên bản</th><th>Bộ dữ liệu</th><th class="num">Ảnh</th><th class="num">Mean IoU</th><th class="num">Success</th><th class="num">ms</th><th>Thời điểm</th></tr></thead><tbody>
      ${rows.map(({ d, r }) => `<tr class="link" data-href="${esc(href(`/d/${encodeURIComponent(d.name)}`, { run: r.run }))}"><td class="mono">${esc(r.run)}</td><td>${esc(d.name)}</td>
        <td class="num">${fmt.int(r.summary.images)}${r.summary.images < d.images ? `<span class="muted">/${fmt.int(d.images)}</span>` : ""}</td>
        <td class="num">${fmt.iou(r.summary.meanIoU)}</td><td class="num">${fmt.pct(r.summary.success)}</td><td class="num">${fmt.ms(r.summary.msMedian)}</td><td class="muted">${fmt.date(r.createdAt)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function render() {
    const running = status.running;
    main.innerHTML = `
      <header class="page-hero hero-amber"><div><h1>Chạy đánh giá</h1><p>Chạy một phiên bản detect trên các bộ dữ liệu rồi so với nhãn đúng. Kết quả ghi vào <span class="mono">Core/results/&lt;phiên bản&gt;@&lt;letterbox&gt;/&lt;bộ&gt;.json</span> và hiện ngay ở Tổng quan. Chạy lại cùng cấu hình sẽ ghi đè.</p></div></header>
      <div class="eval-grid">
        <div class="card c-amber"><div class="card-h"><h2>Cấu hình</h2></div><div class="card-b form">
          <div class="field"><span class="label">Phiên bản detect</span><div class="chips">${dets.map((d) => `<label class="chip${d.version === form.version ? " on" : ""}" title="${esc(d.description)}"><input type="radio" name="ev" value="${esc(d.version)}"${d.version === form.version ? " checked" : ""}><b class="mono">${esc(d.version)}</b> <span class="count">${esc(d.name)}</span></label>`).join("")}</div></div>
          <div class="field"><span class="label">Letterbox (cạnh ảnh vuông đưa vào detect)</span><div class="chips">${[...new Set([...SIZES, form.size])].sort((a, b) => a - b).map((s) => `<label class="chip${s === form.size ? " on" : ""}"><input type="radio" name="es" value="${s}"${s === form.size ? " checked" : ""}>${s}</label>`).join("")}</div></div>
          <div class="field"><span class="label">Bộ dữ liệu</span><div class="chips">${ctx.meta.datasets.map((d) => `<label class="chip${form.datasets.has(d.name) ? " on" : ""}"><input type="checkbox" name="ed" value="${esc(d.name)}"${form.datasets.has(d.name) ? " checked" : ""}>${esc(d.name)}<span class="count">${fmt.int(d.images)}</span></label>`).join("")}</div></div>
          <div class="field"><span class="label">Giới hạn số ảnh mỗi bộ (để thử nhanh)</span><input class="input" id="limit" type="number" min="1" placeholder="Để trống = tất cả (lấy rải đều)" value="${esc(form.limit)}" style="max-width:280px"></div>
          <div><button class="btn primary" id="start" type="button"${running || !form.datasets.size ? " disabled" : ""}>${running ? "Đang chạy…" : `Chạy ${esc(form.version)}@${form.size}`}</button></div>
        </div></div>
        <div class="card c-amber"><div class="card-h"><h2>Tiến độ</h2></div><div class="card-b" id="status">${statusHtml()}</div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h2>Các kết quả đã có</h2><span class="muted">bấm để xem</span></div>${resultsHtml()}</div>`;
  }

  render();

  let timer = 0;
  let wasRunning = status.running;
  async function poll() {
    try {
      status = await api("/api/eval/status");
    } catch { /* server tắt giữa chừng: thử lại sau */ }
    if (ctx.stale()) return;
    if (wasRunning && !status.running) {
      await ctx.refreshMeta();
      toast(status.error ? "Đánh giá lỗi" : status.cancelled ? "Đã dừng" : "Đánh giá xong, kết quả đã cập nhật");
      render();
    } else {
      main.querySelector("#status").innerHTML = statusHtml();
    }
    wasRunning = status.running;
    if (status.running) timer = setTimeout(poll, 1000);
  }
  if (status.running) timer = setTimeout(poll, 1000);

  const onChange = (e) => {
    const t = e.target;
    if (t.name === "ev") form.version = t.value;
    else if (t.name === "es") form.size = +t.value;
    else if (t.name === "ed") t.checked ? form.datasets.add(t.value) : form.datasets.delete(t.value);
    else if (t.id === "limit") { form.limit = t.value; return; }
    else return;
    render();
  };
  const onClick = async (e) => {
    if (e.target.id === "start") {
      const limit = parseInt(main.querySelector("#limit").value, 10) || null;
      try {
        status = await api("/api/eval/run", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: form.version, size: form.size, datasets: [...form.datasets], limit }),
        });
        wasRunning = true;
        render();
        clearTimeout(timer);
        timer = setTimeout(poll, 800);
      } catch (err) { toast(err.message, 6000); }
    } else if (e.target.id === "cancel") {
      status = await api("/api/eval/cancel", { method: "POST" });
      main.querySelector("#status").innerHTML = statusHtml();
    }
  };
  main.addEventListener("change", onChange);
  main.addEventListener("click", onClick);
  return () => {
    clearTimeout(timer);
    main.removeEventListener("change", onChange);
    main.removeEventListener("click", onClick);
  };
}
