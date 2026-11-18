import { api, esc, shot, COLORS } from "../lib.js";

// Trang thuật toán: v3 chạy TỪNG BƯỚC trên một ảnh thật (ảnh trung gian từ detect/v3/mirror.py, kết quả cuối từ
// thư viện native), sau đó là khác biệt v2 → v3, tham số đang nạp, kết quả đo và giới hạn.

const params = [
  ["work_side", "Cạnh dài tối đa của ảnh làm việc (px); không phóng to ảnh nhỏ."],
  ["low_contrast_std", "Độ lệch chuẩn mức xám thấp hơn ngưỡng: dừng sớm với lowContrast."],
  ["close_kernel", "Đường kính kernel ellipse đóng hình thái (px)."],
  ["close_iterations", "Số lần đóng hình thái để giảm nét chữ trước khi tìm đường."],
  ["min_segment", "Chiều dài tối thiểu đoạn LSD, chia cho cạnh dài ảnh."],
  ["merge_angle", "Sai khác hướng tối đa để gộp đoạn (radian)."],
  ["merge_dist", "Khoảng cách tối đa từ đầu đoạn tới đường để gộp (px)."],
  ["min_line_cover", "Tổng chiều dài được các đoạn thật phủ / cạnh dài ảnh tối thiểu."],
  ["max_lines", "Số đường dài nhất giữ lại để ghép tứ giác."],
  ["parallel_tol", "Sai khác hướng tối đa giữa hai cạnh đối (radian)."],
  ["min_corner_angle_sin", "Ngưỡng |sin| giữa hướng trung bình của hai cặp cạnh đối; giới hạn phối cảnh mạnh."],
  ["min_side_separation", "Khoảng cách tối thiểu giữa cạnh đối / cạnh dài ảnh."],
  ["min_area_ratio", "Diện tích tứ giác tối thiểu / diện tích ảnh làm việc."],
  ["corner_margin", "Biên cho phép giao điểm vượt ra ngoài ảnh, theo tỷ lệ chiều rộng/cao."],
  ["prescore_keep", "Số ứng viên từ đường thẳng giữ lại sau chấm điểm sơ bộ."],
  ["use_regions", "Bật ứng viên vùng màu/sáng/tối; trong v3 cũng bật nhánh contour Canny."],
  ["grad_sigma", "Sigma Gaussian trước Sobel khi chấm điểm."],
  ["lab_sigma", "Sigma Gaussian làm mờ Lab trước đo tương phản trong/ngoài."],
  ["sample_step", "Khoảng cách lấy mẫu dọc cạnh (px)."],
  ["side_trim", "Tỷ lệ bỏ ở mỗi đầu cạnh khi lấy mẫu."],
  ["edge_window", "Bán kính tìm gradient theo pháp tuyến (px)."],
  ["contrast_offset", "Khoảng cách mẫu màu tới cạnh, về phía trong/ngoài (px)."],
  ["contrast_full", "Khoảng cách màu Lab quy đổi thành tương phản bằng 1."],
  ["border_credit", "Mức điểm giả định khi phía ngoài cạnh nằm ngoài ảnh; không phải bằng chứng biên thật."],
  ["border_touch_px", "Khoảng cách tối đa tới mép ảnh để áp dụng border_credit (px)."],
  ["min_score", "Điểm bằng chứng tối thiểu để trả found=true; không phải xác suất."],
  ["confidence_full", "confidence = min(1, score / ngưỡng này); chưa hiệu chuẩn xác suất."],
  ["roi_x", "Tọa độ x của vùng ảnh thật trong ảnh đầu vào (px)."],
  ["roi_y", "Tọa độ y của vùng ảnh thật trong ảnh đầu vào (px)."],
  ["roi_w", "Chiều rộng vùng ảnh thật; 0 dùng toàn ảnh."],
  ["roi_h", "Chiều cao vùng ảnh thật; 0 dùng toàn ảnh."],
];

const num = (v, digits = 3) => v == null ? "—" : Number(v).toFixed(digits).replace(/\.?0+$/, "") || "0";
const pct = (v) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
const SOURCE_NAME = { lines: "đường thẳng", color: "vùng màu", bright: "vùng sáng", dark: "vùng tối", edges: "biên Canny" };

// ------------------------------------------------------------------ vẽ

/** Ảnh + lớp SVG; tọa độ lớp theo hệ (w, h) của ảnh. */
function fig({ src, w, h, svg = "", caption = "", pixel = false, id = "" }) {
  return `<figure class="xfig"${id ? ` id="${id}"` : ""}>
    <div class="xshot${pixel ? " pixel" : ""}" style="--r:${(w / h).toFixed(5)}"><img src="${src}" alt="" decoding="async">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${svg}</svg></div>
    ${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
}

const P = (q, w, h) => q.map(([x, y]) => `${(x * w).toFixed(2)},${(y * h).toFixed(2)}`).join(" ");
const poly = (q, w, h, color, extra = "") =>
  `<polygon points="${P(q, w, h)}" style="stroke:${color};fill:${color}" fill-opacity="0" stroke-width="2" ${extra}/>`;
const dots = (q, w, h, color, r = 2.2) => q.map(([x, y]) => `<circle cx="${x * w}" cy="${y * h}" r="${r}" style="fill:${color}"/>`).join("");
const segs = (list, w, h, color, width = 1.5) =>
  list.map(([x1, y1, x2, y2]) => `<line x1="${x1 * w}" y1="${y1 * h}" x2="${x2 * w}" y2="${y2 * h}" style="stroke:${color}" stroke-width="${width}"/>`).join("");

function step(n, id, title, gist, figs, why) {
  return `<section class="card algo-step" id="${id}">
    <header><span class="step-no">${n}</span><div><h3>${title}</h3><p>${gist}</p></div></header>
    <div class="step-figs">${figs}</div>
    <dl class="step-why">
      <div><dt>Có được gì</dt><dd>${why.get}</dd></div>
      <div><dt>Dùng gì</dt><dd>${why.use}</dd></div>
      <div><dt>Vì sao chọn cách này</dt><dd>${why.reason}</dd></div>
    </dl></section>`;
}

// ------------------------------------------------------------------ từng bước

function stepsHtml(d) {
  // Tham số native là float32 (0.4 -> 0.4000000059604645): làm tròn để hiển thị.
  d.params = Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, Number.isInteger(v) ? v : +v.toPrecision(3)]));
  const { W, H, w, h } = d.size;
  const I = d.images;
  const out = [];
  const nat = d.native;
  const scale = (W / w).toFixed(1);

  out.push(step(1, "s-prep", "Ảnh vào → ảnh làm việc 256 px, mức xám",
    `Thu nhỏ ${W} × ${H} → <b>${w} × ${h}</b> (ít hơn ${Math.round((W * H) / (w * h))} lần số điểm ảnh), rồi đổi sang mức xám.`,
    fig({ src: I.input, w: W, h: H, caption: `Ảnh vào ${W} × ${H}` }) +
    fig({ src: I.work, w, h, caption: `Ảnh làm việc ${w} × ${h} (INTER_AREA)` }) +
    fig({ src: I.gray, w, h, caption: `Mức xám · độ nét (phương sai Laplacian) ${num(d.stats.sharpness, 0)} · độ lệch chuẩn ${num(d.stats.std, 1)}` }),
    {
      get: `Ảnh nhỏ cố định cạnh dài 256 px để mọi bước sau chạy nhanh và mọi ngưỡng tính bằng pixel đều có cùng ý nghĩa với mọi ảnh vào. Độ lệch chuẩn mức xám &lt; 8 nghĩa là ảnh gần như phẳng (đen, mờ, chói) → dừng ngay, trả <code>lowContrast</code>.`,
      use: `<code>cv::resize(INTER_AREA)</code>, <code>cv::cvtColor(BGR2GRAY)</code>, <code>cv::Laplacian</code> + <code>meanStdDev</code>.`,
      reason: `Mép tờ giấy là cấu trúc <i>lớn</i> — ở 256 px vẫn rõ, trong khi chữ và vân nền (gây nhiễu) bị nhỏ đi. Mỗi pixel ở đây đại diện cho khoảng ${scale} × ${scale} pixel gốc. INTER_AREA lấy trung bình vùng nên không răng cưa như bilinear khi thu nhỏ mạnh. Độ chính xác góc được bù lại ở bước tinh chỉnh (bước 8) và khi app chụp thì nắn trên ảnh gốc.`,
    }));
  if (d.stats.lowContrast) {
    out.push(`<div class="alert">Ảnh này dừng ở bước 1: độ lệch chuẩn ${num(d.stats.std, 1)} &lt; ${d.params.low_contrast_std}.</div>`);
    return out.join("");
  }

  out.push(step(2, "s-close", "Xóa chữ, giữ mép giấy: đóng hình thái",
    `Phóng to một vùng 48 × 48 px giữa trang: nét chữ tối mảnh bị lấp, mép giấy (vùng lớn) giữ nguyên.`,
    fig({ src: I.zoomGray, w: 288, h: 288, pixel: true, caption: "Trước: mức xám (phóng to 6×)" }) +
    fig({ src: I.zoomSmooth, w: 288, h: 288, pixel: true, caption: "Sau: đóng ellipse 3×3, 2 lần" }) +
    fig({ src: I.smooth, w, h, caption: "Cả ảnh sau khi đóng — đầu vào của LSD, Canny, chấm điểm" }),
    {
      get: `Ảnh xám "sạch": bên trong trang gần như đồng màu, mép trang vẫn sắc. Bước tìm đường và tìm biên phía sau không bị hàng nghìn cạnh nhỏ của chữ làm nhiễu.`,
      use: `<code>cv::morphologyEx(MORPH_CLOSE)</code> với kernel ellipse ${d.params.close_kernel}×${d.params.close_kernel}, ${d.params.close_iterations} lần. Đóng = giãn (dilate) rồi co (erode): vùng tối mảnh hơn kernel biến mất.`,
      reason: `Làm mờ Gaussian cũng xóa được chữ nhưng làm nhòe luôn mép trang. Đóng hình thái là phép <i>không tuyến tính</i>: chỉ xóa chi tiết tối nhỏ hơn kernel, cạnh của vùng lớn giữ nguyên vị trí. Kernel nhỏ (3 px ở ảnh 256) đủ cho nét chữ; lớn hơn sẽ bắt đầu ăn vào góc giấy.`,
    }));

  const lineSvg = segs(d.lines.map((l) => l.pts), w, h, "var(--b)", 2.2);
  out.push(step(3, "s-lines", "Tìm đoạn thẳng (LSD) rồi gộp thành đường dài",
    `${d.segments.length} đoạn thẳng → gộp còn <b>${d.lines.length}</b> đường đủ dài (tối đa ${d.params.max_lines}).`,
    fig({ src: I.smooth, w, h, svg: segs(d.segments, w, h, "var(--lines)", 1.4), caption: `${d.segments.length} đoạn LSD (vàng)` }) +
    fig({ src: I.work, w, h, svg: lineSvg, caption: `${d.lines.length} đường sau khi gộp (cam), xếp theo độ phủ` }),
    {
      get: `Danh sách đường thẳng dài, mỗi đường nhớ cả <i>những khúc thật sự có biên</i> (để biết cạnh tứ giác được "phủ" bao nhiêu ở bước sau).`,
      use: `<code>cv::createLineSegmentDetector(LSD_REFINE_STD)</code>. Gộp đoạn dài ≥ ${pct(d.params.min_segment)} cạnh ảnh nếu lệch hướng ≤ ${d.params.merge_angle} rad và hai đầu cách đường ≤ ${d.params.merge_dist} px; khớp lại đường theo trọng số độ dài; giữ đường phủ ≥ ${pct(d.params.min_line_cover)} cạnh ảnh.`,
      reason: `LSD cho đoạn thẳng có đầu mút, tự kiểm soát báo nhầm, không cần chỉnh ngưỡng tay như Hough. Mép trang thực tế bị ngắt quãng (ngón tay, bóng, chữ sát mép, góc cong) nên một mép thường thành nhiều đoạn — gộp lại mới ra một đường dài đáng tin.`,
    }));

  const lineCands = d.candidates.filter((c) => c.source === "lines").slice(0, 12);
  out.push(step(4, "s-quads", "Ghép bốn đường thành tứ giác",
    `${d.lineCandidates} tổ hợp hợp lệ, giữ ${Math.min(d.lineCandidates, d.params.prescore_keep)} có điểm sơ bộ cao nhất. Hình: ${Math.min(12, d.lineCandidates)} ứng viên tốt nhất.`,
    fig({ src: I.work, w, h, svg: lineSvg.replace(/stroke-width="2.2"/g, 'stroke-width="1" stroke-opacity=".5"') + lineCands.map((c, k) => poly(c.quad, w, h, `hsl(${(k * 47) % 360} 85% 55%)`, 'stroke-width="1.6"')).join(""), caption: "Ứng viên từ đường thẳng (mỗi màu một tứ giác)" }),
    {
      get: `Các tứ giác lồi tạo bởi hai cặp cạnh đối. Mỗi tứ giác có điểm sơ bộ = (tổng phần chu vi có biên thật / chu vi) × diện tích<sup>0,2</sup>.`,
      use: `Hai đường là một cặp cạnh đối nếu lệch hướng ≤ ${d.params.parallel_tol} rad và cách nhau ≥ ${pct(d.params.min_side_separation)} cạnh ảnh; hai cặp phải đủ "vuông" (|sin| ≥ ${d.params.min_corner_angle_sin}); giao điểm không ra ngoài ảnh quá ${pct(d.params.corner_margin)}; diện tích ≥ ${pct(d.params.min_area_ratio)} ảnh.`,
      reason: `Tờ giấy chụp nghiêng vẫn là tứ giác có hai cặp cạnh "gần song song", nên các luật hình học này loại nhanh hàng nghìn tổ hợp vô nghĩa trước khi phải chấm điểm tốn kém. Lũy thừa 0,2 của diện tích giữ lại mép trang lớn, để các ô chữ nhật nhỏ bên trong (ảnh, bảng) không chiếm hết danh sách.`,
    }));

  const R = d.regions;
  const regionFig = (name, title) => {
    const ks = R[name] || [];
    const svg = ks.map((k) => (k.quad ? poly(k.quad, w, h, "var(--good)", 'stroke-width="2.5"') : "")
      + `<polyline points="${P(k.contour, w, h)}" style="stroke:var(--bad);fill:none" stroke-width="1.2" stroke-dasharray="3 2"/>`).join("");
    const note = ks.length ? ks.map((k) => k.why ? `loại (${k.why})` : "→ ứng viên").join(", ") : "không có vùng đủ lớn";
    return fig({ src: I[`mask_${name}`], w, h, svg, pixel: true, caption: `${title}: ${note}` });
  };
  out.push(step(5, "s-regions", "Ứng viên từ vùng: khác màu nền, sáng, tối",
    `Màu nền = trung vị Lab của dải viền ảnh (L ${d.background[0]}, a ${d.background[1]}, b ${d.background[2]}). Mặt nạ trắng = vùng được chọn; viền đỏ = contour; xanh = tứ giác nhận.`,
    fig({ src: I.colorDist, w, h, caption: "Khoảng cách màu tới nền (sáng = khác nền)" }) +
    regionFig("color", "Khác màu nền (Otsu)") + regionFig("bright", "Vùng sáng (Otsu)") + regionFig("dark", "Vùng tối"),
    {
      get: `Thêm vài ứng viên dựa trên <i>vùng</i> thay vì đường: hữu ích khi mép giấy không thành đường thẳng rõ (giấy trắng trên nền sáng, góc bo, mép bị che).`,
      use: `<code>cvtColor(BGR2Lab)</code>, khoảng cách Lab tới màu nền, <code>threshold(THRESH_OTSU)</code>, đóng/mở hình thái, <code>findContours</code>, <code>convexHull</code> + <code>approxPolyDP</code> (2–8% chu vi) phải ra đúng 4 đỉnh, diện tích contour / tứ giác trong [0,82; 1,18].`,
      reason: `Lab tách độ sáng (L) khỏi màu (a, b) và khoảng cách Lab gần với cảm nhận của mắt hơn RGB. Otsu tự chọn ngưỡng theo histogram từng ảnh nên không cần ngưỡng cứng. Điều kiện "lấp đầy" 0,82–1,18 loại các vùng không giống tờ giấy — v2 thiếu điều kiện này và dùng minAreaRect cho mọi vùng, là một nguồn báo nhầm.`,
    }));

  const edgeCands = d.candidates.filter((c) => c.source === "edges");
  out.push(step(6, "s-edges", "Ứng viên từ biên Canny",
    `Hai cặp ngưỡng (20/60 nhạy, 50/150 chặt). Contour xấp xỉ được 4 đỉnh lồi → ${edgeCands.length} ứng viên (xanh).`,
    fig({ src: I.canny20, w, h, pixel: true, svg: edgeCands.slice(0, 6).map((c) => poly(c.quad, w, h, "var(--good)", 'stroke-width="2"')).join(""), caption: "Canny 20/60 + đóng 3×3" }) +
    fig({ src: I.canny50, w, h, pixel: true, caption: "Canny 50/150 + đóng 3×3" }),
    {
      get: `Ứng viên từ đường biên khép kín: bắt được trang có mép rõ nhưng bị LSD cắt vụn (mép hơi cong, góc bo).`,
      use: `<code>cv::Canny</code> trên ảnh đã đóng hình thái, <code>morphologyEx(CLOSE, 3×3)</code> để nối biên đứt, <code>findContours(RETR_LIST)</code>, <code>approxPolyDP(2,5%)</code>, <code>isContourConvex</code>; giữ tối đa 24 tứ giác lớn nhất.`,
      reason: `Ba nguồn bổ sung cho nhau: đường thẳng mạnh khi mép thẳng nhưng có khe hở; vùng mạnh khi màu giấy khác nền; Canny mạnh khi mép khép kín. Hai ngưỡng vì không có một ngưỡng hợp mọi ánh sáng. Tất cả ứng viên đều đi qua cùng một bộ chấm điểm ở bước sau nên thêm nguồn không làm tăng báo nhầm nếu điểm đủ chặt.`,
    }));

  const top = d.candidates.slice(0, 8);
  const win = d.candidates.find((c) => c.i === d.best);
  const sampleColor = { edge: "var(--good)", none: "var(--bad)", border: "var(--muted)" };
  const samples = (d.mirror.samples || []).map(([x, y, s]) => `<circle cx="${x * w}" cy="${y * h}" r="1.6" style="fill:${sampleColor[s]}"/>`).join("");
  out.push(step(7, "s-score", "Chấm điểm mọi ứng viên bằng bằng chứng trên ảnh",
    `${d.candidates.length} ứng viên được chấm cùng một công thức. Mỗi cạnh lấy mẫu mỗi ${d.params.sample_step} px: có biên thật (xanh), không (đỏ), sát mép ảnh (xám).`,
    fig({ src: I.gradient, w, h, caption: `Độ lớn gradient (Sobel). Ngưỡng biên tự thích nghi = ${d.edgeThresh}` }) +
    fig({ src: I.work, w, h, svg: (win ? poly(win.quad, w, h, "var(--b)", 'stroke-width="1" stroke-opacity=".6"') : "") + samples, caption: "Điểm mẫu trên các cạnh của ứng viên thắng" }) +
    candidateTable(top, d, w, h),
    {
      get: `Mỗi ứng viên có: <b>độ phủ</b> từng cạnh (tỷ lệ điểm mẫu có biên vuông góc mạnh trong ±${d.params.edge_window} px), <b>tương phản</b> (chênh màu Lab hai bên cạnh cách ${d.params.contrast_offset} px), <b>đồng nhất</b> (màu phía trong 4 cạnh có giống cùng một tờ giấy), và diện tích.`,
      use: `<code>GaussianBlur</code> + <code>Sobel</code> (gradient), phân vị 97 cho ngưỡng biên, Lab làm mờ cho tương phản. Công thức: <code>cạnh = phủ × min(1, tương phản/${d.params.contrast_full})</code>, <code>tổng = 0,65 × trung bình theo độ dài + 0,35 × cạnh yếu nhất</code>, nhân đồng nhất và hệ số diện tích; cạnh phủ &lt; 10% → ×0,5.`,
      reason: `Ứng viên từ mọi nguồn được so trên <i>cùng một thước đo</i> là bằng chứng trên ảnh, nên dễ hiểu và dễ chỉnh. Phần "0,35 × cạnh yếu nhất" và mức phạt chặn trường hợp hai cạnh rất mạnh che lấp hai cạnh không có thật (ví dụ mép bàn). Ngưỡng biên theo phân vị nên ảnh tối/sáng đều dùng được.`,
    }));

  out.push(step(8, "s-pick", "Chọn: ưu tiên tờ giấy ngoài cùng",
    win ? `Thắng: ứng viên từ <b>${SOURCE_NAME[win.source]}</b>, điểm ${num(win.score)} ≥ ${d.params.min_score}, hạng = điểm × diện tích<sup>¼</sup> = ${num(win.rank)}.`
      : `Không ứng viên nào đạt điểm ${d.params.min_score} → trả <b>không tìm thấy</b>.`,
    scoreBreakdown(win, d, w, h),
    {
      get: `Một tứ giác duy nhất, hoặc "không tìm thấy". <code>confidence = min(1, điểm / ${d.params.confidence_full})</code> — thang heuristic, không phải xác suất.`,
      use: `Lọc điểm ≥ ${d.params.min_score}, xếp theo <code>hạng = điểm × diện tích^0,25</code>.`,
      reason: `Trên một trang in thường có ảnh, bảng, khung chữ — cũng là hình chữ nhật có biên rõ, đôi khi điểm còn cao hơn mép giấy. Nhân thêm diện tích<sup>¼</sup> (căn bậc bốn, tác động nhẹ) đủ để trang ngoài cùng thắng các khung bên trong mà không để một vùng lớn vô nghĩa thắng một trang rõ ràng. Ngưỡng 0,40 (v2 là 0,30) đổi một ít độ nhạy lấy ít báo nhầm hơn.`,
    }));

  if (d.mirror.found) {
    const m = d.mirror, zc = m.zoomCorner;
    let zoomFig = "";
    if (zc) {
      const ZW = 288, toZ = ([x, y]) => [((x - zc.x0) / zc.size[0]) * ZW, ((y - zc.y0) / zc.size[1]) * ZW];
      const pts = (m.refinePoints || []).flat().map(toZ).filter(([x, y]) => x >= 0 && y >= 0 && x <= ZW && y <= ZW);
      const [bx, by] = toZ(m.before[zc.corner]);
      const [ax, ay] = toZ(m.corners[zc.corner]);
      zoomFig = fig({ src: zc.img, w: ZW, h: ZW, pixel: true,
        svg: pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" style="fill:var(--lines)"/>`).join("")
          + `<circle cx="${bx}" cy="${by}" r="7" style="fill:none;stroke:var(--b)" stroke-width="2.5"/>`
          + `<circle cx="${ax}" cy="${ay}" r="7" style="fill:none;stroke:var(--good)" stroke-width="2.5"/>`,
        caption: `Góc ${["TL", "TR", "BR", "BL"][zc.corner]} phóng to 12×: cam = trước, xanh = sau, vàng = điểm biên tìm được` });
    }
    out.push(step(9, "s-refine", "Tinh chỉnh bốn cạnh trên ảnh xám chưa đóng hình thái",
      m.refined ? `Đã tinh chỉnh: mỗi góc dịch tối đa ${num(Math.max(...m.corners.map((p, i) => Math.hypot((p[0] - m.before[i][0]) * w, (p[1] - m.before[i][1]) * h))), 2)} px.`
        : `Giữ nguyên tứ giác cũ vì: ${esc(m.refineReason)}.`,
      zoomFig + fig({ src: I.gray, w, h, svg: poly(m.before, w, h, "var(--b)", 'stroke-width="1.5"') + poly(m.corners, w, h, "var(--good)", 'stroke-width="1.5"') + dots((m.refinePoints || []).flat(), w, h, "var(--lines)", 1.1), caption: "Toàn ảnh: cam = ứng viên, xanh = sau tinh chỉnh" }),
      {
        get: `Bốn góc chính xác hơn (dưới pixel của ảnh làm việc) — quan trọng vì khi nắn phẳng, sai 1 px ở ảnh 256 thành ~${scale} px ở ảnh gốc.`,
        use: `<code>GaussianBlur</code> + <code>Sobel</code> trên ảnh xám gốc; dọc mỗi cạnh tìm điểm có gradient mạnh và vuông góc trong ±3 px (ưu tiên gần vị trí cũ); <code>cv::fitLine(DIST_HUBER)</code>; giao 4 đường.`,
        reason: `Đóng hình thái (bước 2) có thể dời mép giấy ~1 px, nên phải tìm lại trên ảnh gốc. Huber ít bị kéo lệch bởi điểm ngoại lai (chữ sát mép, bóng) hơn bình phương tối thiểu. Kết quả chỉ được nhận khi đủ ≥ 60% điểm biên, tứ giác vẫn lồi và không góc nào dịch quá 5 px — nếu không, giữ kết quả cũ (an toàn hơn là "sửa sai").`,
      }));
  }

  out.push(step(10, "s-result", "Kết quả của thư viện native và ảnh nắn phẳng",
    nat.found ? `Native trả <b>${nat.method}</b>, điểm ${num(nat.score)}, độ tin cậy ${num(nat.confidence, 2)}, ${num(nat.ms, 1)} ms trên máy chủ.`
      : `Native trả <b>không tìm thấy</b>${nat.score ? ` (điểm cao nhất ${num(nat.score)} &lt; ${d.params.min_score})` : ""}.`,
    fig({ src: I.input, w: W, h: H, svg: (d.source.gt ? poly(d.source.gt, W, H, "var(--gt)", 'stroke-dasharray="10 7" stroke-width="2"') : "") + (nat.corners ? poly(nat.corners, W, H, "var(--b)", 'stroke-width="3"') + dots(nat.corners, W, H, "var(--b)", Math.max(W, H) * 0.008) : ""), caption: `Cam = kết quả native${d.source.gt ? ", xanh đứt = nhãn" : ""}` }) +
    (I.warp ? `<figure class="xfig"><img class="warp" src="${I.warp}" alt="Ảnh nắn phẳng"><figcaption>Nắn phẳng: <code>getPerspectiveTransform</code> + <code>warpPerspective</code></figcaption></figure>` : ""),
    {
      get: `Bốn góc TL → TR → BR → BL, chuẩn hóa 0–1 theo ảnh vào. App dùng chúng để nắn phẳng trên ảnh độ phân giải gốc.`,
      use: `Thư viện C++ <code>docdetect_v3</code> (cùng mã chạy trên server, trong app dạng WebAssembly). Nắn phẳng: kích thước ra = cạnh dài nhất của mỗi cặp cạnh đối.`,
      reason: `Toàn bộ ảnh trung gian ở trên được tạo lại bằng bản soi Python (cùng hàm, cùng tham số) để nhìn thấy được. ${d.mirror.matches ? `Với ảnh này bản soi <b>khớp</b> native${d.mirror.maxDiff != null ? ` (góc lệch ${num(d.mirror.maxDiff * 100, 3)}%)` : ""}.` : `<b>Với ảnh này bản soi lệch native</b> — hình minh họa chỉ mang tính gần đúng.`}${d.mirrorCheck ? ` Trên ${d.mirrorCheck.images} ảnh dataset: ${d.mirrorCheck.sameFound} cùng kết luận, ${d.mirrorCheck.cornersWithin05pct}/${d.mirrorCheck.bothFound} góc lệch &lt; 0,5%.` : ""}`,
    }));
  return out.join("");
}

function candidateTable(top, d, w, h) {
  const bars = (vals) => `<span class="mini-bars">${vals.map((v) => `<i style="--v:${Math.max(0.04, v)}" title="${num(v, 2)}"></i>`).join("")}</span>`;
  const rows = top.map((c, k) => {
    const cls = c.i === d.best && c.score >= d.params.min_score ? "win" : c.score < d.params.min_score ? "below" : "";
    return `<tr data-cand="${k}" class="${cls}"><td>${k + 1}</td><td>${SOURCE_NAME[c.source]}</td><td>${bars(c.coverage)}</td><td>${bars(c.contrast)}</td>
      <td>${num(c.consistency, 2)}</td><td>${pct(c.area)}</td><td><b>${num(c.score)}</b>${c.penalized ? ' <span class="badge bad" title="có cạnh phủ &lt; 10% → ×0,5">phạt</span>' : ""}</td><td>${num(c.rank)}</td></tr>`;
  }).join("");
  const svg = top.map((c, k) => poly(c.quad, w, h, c.i === d.best ? "var(--b)" : "var(--a)", `data-cand="${k}" class="cand" stroke-width="${c.i === d.best ? 2.5 : 1.2}"`)).join("");
  return `<div class="cand-wrap">${fig({ src: d.images.work, w, h, svg, caption: "8 ứng viên hạng cao nhất — rê chuột lên bảng để xem từng cái" })}
    <div class="scroll"><table class="table cand-table"><thead><tr><th>#</th><th>Nguồn</th><th>Phủ (T R B L)</th><th>Tương phản</th><th>Đồng nhất</th><th>Diện tích</th><th>Điểm</th><th>Hạng</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted cand-legend"><span class="sw win"></span> được chọn · <span class="sw below"></span> điểm &lt; ${d.params.min_score} (hạng bị trừ 1) · còn lại: đạt ngưỡng nhưng hạng thấp hơn</p></div></div>`;
}

function scoreBreakdown(c, d, w, h) {
  if (!c) return `<p class="muted">Không có ứng viên đạt ngưỡng; xem bảng ứng viên ở bước 7.</p>`;
  const q = c.quad.map(([x, y]) => [x * w, y * h]);
  const len = q.map((p, i) => Math.hypot(q[(i + 1) % 4][0] - p[0], q[(i + 1) % 4][1] - p[1]));
  const side = c.coverage.map((v, i) => v * c.contrast[i]);
  const mean = side.reduce((s, v, i) => s + v * len[i], 0) / len.reduce((a, b) => a + b, 0);
  const minSide = Math.min(...side);
  const overall = 0.65 * mean + 0.35 * minSide;
  const size = 0.85 + 0.15 * Math.min(1, c.area / 0.5);
  const names = ["trên", "phải", "dưới", "trái"];
  return `<div class="score-break">
    <table class="table"><thead><tr><th>Cạnh</th><th>Độ phủ</th><th>× Tương phản</th><th>= Điểm cạnh</th><th>Dài (px)</th></tr></thead><tbody>
    ${names.map((n, i) => `<tr><th>${n}</th><td>${num(c.coverage[i], 2)}</td><td>${num(c.contrast[i], 2)}</td><td><b>${num(side[i], 2)}</b></td><td>${num(len[i], 0)}</td></tr>`).join("")}</tbody></table>
    <pre><code>trung bình theo độ dài  = ${num(mean)}
cạnh yếu nhất           = ${num(minSide)}
tổng   = 0,65 × ${num(mean)} + 0,35 × ${num(minSide)} = ${num(overall)}
điểm   = tổng × đồng nhất ${num(c.consistency)} × diện tích ${num(size)}${c.penalized ? " × 0,5 (phạt)" : ""} = <b>${num(c.score)}</b>
hạng   = ${num(c.score)} × ${pct(c.area)}^0,25 = <b>${num(c.rank)}</b></code></pre></div>`;
}

// ------------------------------------------------------------------ các phần giữ lại

function measurements(report) {
  if (!report) return `<p>Chưa có phép so sánh độc lập trong <code>Core/reports/v3-validation.json</code>.</p>`;
  const rows = Object.entries(report.datasets).map(([ds, versions]) => {
    const a = versions.v2, b = versions.v3;
    if (!a || !b) return "";
    const pair = (key, format) => `<td>${format(a[key])} → <b>${format(b[key])}</b></td>`;
    return `<tr><th>${esc(ds)}</th><td>${b.positives} / ${b.negatives}</td>
      ${pair("meanIoU", (v) => num(v))}${pair("success", pct)}${pair("falsePositive", pct)}
      ${pair("msMedian", (v) => num(v, 1))}${pair("msP95", (v) => num(v, 1))}</tr>`;
  }).join("");
  return `<p>Mỗi ô ghi <b>v2 → v3</b>. Cùng ảnh, letterbox ${report.size} px, cùng tiến trình; thứ tự hai phiên bản được đảo luân phiên. Làm nóng bằng ảnh thật, không tính đọc ảnh và letterbox.</p>
    ${report.matchesSources ? "" : '<div class="alert">Mã C++ hiện tại khác bản đã đo. Cần chạy lại comparison trước khi kết luận.</div>'}
    <div class="scroll"><table class="table"><thead><tr><th>Dataset</th><th>Có / không có tài liệu</th><th>Mean IoU ↑</th><th>Success@0.9 ↑</th><th>Báo nhầm ↓</th><th>Trung vị ms ↓</th><th>p95 ms ↓</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted">Đo ${esc(report.createdAt || "")} · ${esc(report.environment?.platform || "")} · ${esc(report.environment?.threads || "1")} luồng OpenCV. Đây là số trên máy chạy báo cáo, chưa phải mobile.</p>
    <p>Tập phát triển và kiểm tra tách bằng SHA256 của ID (DocCorner) hoặc tên video (SmartDoc), để các frame cùng video không lọt sang hai phía. Roboflow dùng train để phát triển, val/test để kiểm tra. Chỉ số tổng hợp của tập kiểm tra đã được xem trong quá trình phát triển; đây là validation, không phải bài kiểm tra mù cuối cùng.</p>
    <p>Mean IoU chỉ tính ảnh có tài liệu, tính cả ảnh bỏ sót bằng 0. Success@0.9 là tỷ lệ IoU ≥ 0.9. Báo nhầm là tỷ lệ <code>found=true</code> trên ảnh âm; dấu “—” nghĩa là tập con không có ảnh âm. Roboflow có nhãn bbox nên điểm tứ giác có thể chịu ảnh hưởng của loại nhãn.</p>`;
}

function examples(rows) {
  if (!rows?.length) return "";
  return `<h3>Nhìn trực tiếp: trường hợp cải thiện và trường hợp giảm chất lượng</h3>
    <p>Mỗi bộ lấy ảnh có mức tăng và mức giảm IoU lớn nhất trong mẫu kiểm tra. Đây là ví dụ cực trị để hiểu hành vi, không đại diện cho toàn bộ dữ liệu. Viền xanh lá là nhãn; xanh dương là v2; cam là v3.</p>
    <div class="algorithm-examples">${rows.map((r) => {
      const url = `/api/datasets/${encodeURIComponent(r.dataset)}/images/${encodeURIComponent(r.id)}?thumb=1`;
      return `<figure class="card"><figcaption><b>${esc(r.dataset)}</b> · ${r.kind === "gain" ? "Tăng IoU" : "Giảm IoU"}<br>IoU ${num(r.iou2)} → ${num(r.iou3)}</figcaption>
        <div class="algorithm-example-pair">${["v2", "v3"].map((v) => `<div><b>${v}${r[v] ? "" : " · không thấy"}</b><div class="frame">${shot({src: url, w: r.width, h: r.height, layers: [{pts: r.gt, color: COLORS.gt, dash: true}, {pts: r[v], color: v === "v2" ? COLORS.a : COLORS.b}], alt: `${r.dataset}: ${v} so với nhãn`})}</div></div>`).join("")}</div>
        <a class="btn" href="/d/${encodeURIComponent(r.dataset)}/i/${encodeURIComponent(r.id)}?run=v3@256&vs=v2@256">Mở ảnh và detect lại</a></figure>`;
    }).join("")}</div>`;
}

const V2V3 = [
  ["Giữ ứng viên từ đường thẳng", "30, theo độ phủ", "60, theo độ phủ × diện tích<sup>0,2</sup>", "Mép trang lớn không bị các ô chữ nhật nhỏ đẩy ra khỏi danh sách trước khi được chấm."],
  ["Vùng không ra 4 đỉnh", "Dùng minAreaRect", "Bỏ; thêm điều kiện lấp đầy 0,82–1,18", "Một vùng bất kỳ luôn có hình chữ nhật bao — đó không phải bằng chứng có 4 mép giấy (nguồn báo nhầm của v2)."],
  ["Nguồn ứng viên Canny", "—", "2 cặp ngưỡng, tối đa 24", "Bắt mép khép kín mà LSD cắt vụn (mép cong nhẹ, góc bo)."],
  ["Tương phản đủ", "Lab 22", "Lab 18", "Giấy trắng trên nền sáng vẫn được tính là có cạnh."],
  ["Phạt khác màu bên trong", "tối đa 40%", "tối đa 20%", "Bìa, thẻ, trang in nhiều màu không bị loại oan."],
  ["Điểm giả định ở mép ảnh", "0,45", "0,25", "Không \"cho không\" điểm khi trang tràn ra ngoài khung."],
  ["Cạnh không có bằng chứng", "—", "phủ &lt; 10% → ×0,5", "Hai cạnh rất mạnh không che được hai cạnh không tồn tại."],
  ["Chọn kết quả", "điểm cao nhất, ngưỡng 0,30", "điểm × diện tích<sup>¼</sup>, ngưỡng 0,40", "Ưu tiên trang ngoài thay vì ảnh/khung bên trong; ít báo nhầm hơn."],
  ["Tinh chỉnh góc", "—", "Sobel + fitLine Huber, ≤ 5 px", "Góc chính xác hơn cho bước nắn phẳng."],
];

// ------------------------------------------------------------------ trang

export default async function algorithms(main, ctx) {
  const ds = ctx.q.get("ds"), id = ctx.q.get("id");
  const [data, d] = await Promise.all([
    api("/api/algorithms"),
    api(`/api/algorithms/steps${ds && id ? `?ds=${encodeURIComponent(ds)}&id=${encodeURIComponent(id)}` : ""}`),
  ]);
  if (ctx.stale()) return;
  const a = data.versions.v2, b = data.versions.v3;
  const parameterRows = params.map(([key, text]) => {
    const x = a.params?.[key], y = b.params?.[key];
    return `<tr${x !== y ? ' class="param-changed"' : ""}><th><code>${key}</code></th><td>${num(x)}</td><td>${num(y)}</td><td>${text}</td></tr>`;
  }).join("");
  const cur = d.source;
  const picker = d.examples.map((e) => {
    const on = e.dataset === cur.dataset && e.id === cur.id;
    return `<a class="chip${on ? " on" : ""}" href="/algorithms?ds=${encodeURIComponent(e.dataset)}&id=${encodeURIComponent(e.id)}">${esc(e.title)}</a>`;
  }).join("");
  const flow = [["s-prep", "Thu nhỏ", "256 px, xám"], ["s-close", "Xóa chữ", "đóng hình thái"], ["s-lines", "Đường thẳng", "LSD + gộp"],
    ["s-quads", "Tứ giác", "ghép 4 đường"], ["s-regions", "Vùng", "màu / sáng / tối"], ["s-edges", "Biên", "Canny"],
    ["s-score", "Chấm điểm", "bằng chứng biên"], ["s-pick", "Chọn", "ưu tiên trang ngoài"], ["s-refine", "Tinh chỉnh", "fitLine Huber"], ["s-result", "Kết quả", "4 góc + nắn phẳng"]];

  main.innerHTML = `<article class="algorithm-doc">
    <div class="page-head"><div><h1>Thuật toán nhận diện tài liệu (v3)</h1>
      <p>Tìm bốn góc tờ giấy trong một ảnh bằng xử lý ảnh cổ điển · C++17 + OpenCV core/imgproc · không dùng mạng neural</p></div>
      <div class="chips"><a class="btn" href="/video">Luồng video trong app →</a><a class="btn" href="/try?version=v3">Thử ảnh của bạn</a></div></div>
    <nav class="algorithm-toc" aria-label="Mục lục">
      <a href="/algorithms#steps">Từng bước trên ảnh thật</a><a href="/algorithms#v2v3">v2 → v3</a><a href="/algorithms#parameters">Tham số</a>
      <a href="/algorithms#validation">Kết quả đo</a><a href="/algorithms#limits">Giới hạn</a></nav>

    <section class="card algorithm-section" id="steps"><h2>Ý tưởng trong một câu</h2>
      <p>Tạo <b>thật nhiều tứ giác ứng viên</b> từ ba nguồn khác nhau (đường thẳng, vùng màu, biên khép kín), rồi <b>chấm điểm mọi ứng viên bằng cùng một thước đo</b> — bốn cạnh có thật sự nằm trên biên rõ, hai phía có khác màu không — và chọn tờ giấy ngoài cùng đủ điểm. Cách "sinh nhiều, chấm chặt" này dễ kiểm tra: mỗi quyết định đều chỉ ra được bằng chứng trên ảnh.</p>
      <ol class="algorithm-flow">${flow.map(([id, t, s]) => `<li><a href="/algorithms${location.search}#${id}"><b>${t}</b><span>${s}</span></a></li>`).join("")}</ol>
      <div class="step-picker"><span class="muted">Chọn ảnh minh họa:</span> <div class="chips">${picker}</div>
        <span class="muted">· hoặc thêm <code>?ds=&lt;bộ&gt;&amp;id=&lt;ảnh&gt;</code> vào URL với ảnh bất kỳ trong dataset (<a href="/d/${encodeURIComponent(cur.dataset)}/i/${encodeURIComponent(cur.id)}">mở ảnh này</a>).</span></div>
    </section>

    ${stepsHtml(d)}

    <section id="v2v3" class="card algorithm-section"><h2>v2 → v3: đổi gì và vì sao</h2>
      <p>v3 được clone từ v2 (thư viện riêng, tiền tố <code>dd3_</code>) để hai bản chạy song song và so sánh được trên cùng ảnh.</p>
      <div class="scroll"><table class="table"><thead><tr><th>Chỗ thay đổi</th><th>v2</th><th>v3</th><th>Lý do</th></tr></thead><tbody>
      ${V2V3.map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td><b>${r[2]}</b></td><td>${r[3]}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">Nguồn: detect.cpp (điều phối), lines.cpp (gộp đường), quads.cpp (ứng viên + tinh chỉnh), scoring.cpp (điểm), geometry.cpp (hình học). Bản soi minh họa: <code>Core/detect/v3/mirror.py</code>, kiểm tra độ khớp: <code>python -m tools.check_mirror</code>.</p>
    </section>

    <section id="parameters" class="card algorithm-section"><h2>Tham số đang được nạp</h2>
      <p>Đọc trực tiếp từ detector native đang chạy. Hàng tô màu là giá trị khác nhau. Tham số px được tính trên ảnh làm việc; thay work_side cần đánh giá lại các ngưỡng.</p>
      ${!a.available || !b.available ? '<div class="alert">Một thư viện chưa được build. Các giá trị chưa có được hiển thị bằng “—”.</div>' : ""}
      <div class="scroll"><table class="table"><thead><tr><th>Tham số</th><th>v2</th><th>v3</th><th>Ý nghĩa</th></tr></thead><tbody>${parameterRows}</tbody></table></div>
    </section>

    <section id="validation" class="card algorithm-section"><h2>So sánh trên tập kiểm tra tách riêng</h2>${measurements(data.validation)}${examples(data.examples)}</section>

    <section id="limits" class="card algorithm-section"><h2>Giới hạn</h2>
      <p>Hình chữ nhật có cạnh rõ chưa chắc là tài liệu: màn hình, mặt bàn, khung ảnh vẫn có thể được nhận (xem ví dụ "Báo nhầm" ở trên). Ưu tiên diện tích cũng có thể chọn nhầm vùng lớn bao quanh trang. Bóng đổ, phản sáng, giấy cong, che khuất và phối cảnh mạnh vẫn là trường hợp khó. v3 chưa phải bộ phân loại ngữ nghĩa tài liệu.</p>
      <p>Mỗi lần gọi detect độc lập với nhau. Trên điện thoại, việc làm khung ổn định qua nhiều khung hình, gợi ý và chụp do lớp điều phối trong app đảm nhiệm — xem <a href="/video">Luồng video trong app</a>.</p>
      <details><summary>Lệnh build và tái lập phép đo</summary><pre><code># Từ thư mục gốc, sau khi đã có OpenCV tĩnh của v2:
.\\Core\\native\\docdetect_v3\\build.ps1

# Từ Core/:
.venv\\Scripts\\python.exe -m tools.compare_versions --phase validation --limit 600 --output reports/v3-validation.json
.venv\\Scripts\\python.exe -m tools.evaluate --version v3 --size 256
.venv\\Scripts\\python.exe -m tools.check_mirror --per-set 60</code></pre></details>
    </section>
  </article>`;

  // Rê chuột lên hàng bảng ứng viên -> làm nổi tứ giác tương ứng.
  const wrap = main.querySelector(".cand-wrap");
  const onHover = (e) => {
    const k = e.target.closest("tr[data-cand]")?.dataset.cand;
    wrap.classList.toggle("hovering", k != null);
    wrap.querySelectorAll("[data-cand]").forEach((el) => el.classList.toggle("hot", el.dataset.cand === k));
  };
  wrap?.addEventListener("mouseover", onHover);
  wrap?.addEventListener("mouseleave", onHover);
}
