import { api, esc, shot, COLORS } from "../lib.js";

// Trang thuật toán v3: chạy từng bước trên một ảnh thật. Ảnh trung gian lấy từ detect/v3/mirror.py (cùng hàm,
// cùng tham số với C++), bốn góc và ảnh nắn phẳng lấy từ thư viện native.

const PARAMS = [
  ["work_side", "Cạnh dài ảnh làm việc (px)"],
  ["low_contrast_std", "Dưới mức này: ảnh quá phẳng, dừng sớm"],
  ["close_kernel", "Kernel đóng hình thái (px)"],
  ["close_iterations", "Số lần đóng hình thái"],
  ["min_segment", "Đoạn LSD ngắn nhất, theo cạnh ảnh"],
  ["merge_angle", "Lệch hướng tối đa khi gộp đoạn (rad)"],
  ["merge_dist", "Khoảng cách tối đa khi gộp đoạn (px)"],
  ["min_line_cover", "Độ phủ tối thiểu của một đường"],
  ["max_lines", "Số đường giữ lại"],
  ["parallel_tol", "Lệch hướng tối đa giữa hai cạnh đối (rad)"],
  ["min_corner_angle_sin", "Hai cặp cạnh phải đủ vuông góc (|sin|)"],
  ["min_side_separation", "Hai cạnh đối cách nhau tối thiểu"],
  ["min_area_ratio", "Diện tích tối thiểu so với ảnh"],
  ["corner_margin", "Góc được ra ngoài ảnh tối đa"],
  ["prescore_keep", "Số ứng viên từ đường thẳng giữ lại"],
  ["use_regions", "Bật ứng viên từ vùng và Canny"],
  ["grad_sigma", "Làm mờ trước Sobel"],
  ["lab_sigma", "Làm mờ Lab trước khi đo tương phản"],
  ["sample_step", "Bước lấy mẫu dọc cạnh (px)"],
  ["side_trim", "Bỏ ở mỗi đầu cạnh khi lấy mẫu"],
  ["edge_window", "Tìm biên trong khoảng ± (px)"],
  ["contrast_offset", "Lấy màu cách cạnh (px)"],
  ["contrast_full", "Chênh màu Lab tính là đủ tương phản"],
  ["border_credit", "Điểm cho cạnh nằm sát mép ảnh"],
  ["border_touch_px", "Khoảng cách tính là sát mép (px)"],
  ["min_score", "Điểm tối thiểu để nhận là tài liệu"],
  ["confidence_full", "Điểm ứng với độ tin cậy 1"],
  ["roi_x", "Vùng xét: x"], ["roi_y", "Vùng xét: y"], ["roi_w", "Vùng xét: rộng (0 = cả ảnh)"], ["roi_h", "Vùng xét: cao (0 = cả ảnh)"],
];

const num = (v, digits = 3) => v == null ? "n/a" : Number(v).toFixed(digits).replace(/\.?0+$/, "") || "0";
const pct = (v) => v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
const SOURCE_NAME = { lines: "đường thẳng", color: "vùng màu", bright: "vùng sáng", dark: "vùng tối", edges: "biên Canny" };

// ------------------------------------------------------------------ vẽ

function fig({ src, w, h, svg = "", caption = "", pixel = false }) {
  return `<figure class="xfig">
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

const PHASE = { prep: ["ph-prep", "Chuẩn bị"], cand: ["ph-cand", "Tìm ứng viên"], score: ["ph-score", "Chấm và chọn"], out: ["ph-out", "Kết quả"] };

function step(n, id, phase, title, lead, figs, why) {
  const [cls, tag] = PHASE[phase];
  return `<section class="kb-sec kb-step ${cls}" id="${id}">
    <header><span class="no">${n}</span><div><span class="tag">${tag}</span><h3>${title}</h3>${lead ? `<p>${lead}</p>` : ""}</div></header>
    ${why.explain ? `<div class="kb-explain">${why.explain}</div>` : ""}
    <div class="kb-figs">${figs}</div>
    <dl class="kb-why">
      <div class="k-get"><dt>Có được gì</dt><dd>${why.get}</dd></div>
      <div class="k-use"><dt>Dùng gì</dt><dd>${why.use}</dd></div>
      <div class="k-why"><dt>Vì sao</dt><dd>${why.reason}</dd></div>
    </dl></section>`;
}

// ------------------------------------------------------------------ từng bước

function stepsHtml(d) {
  d.params = Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, Number.isInteger(v) ? v : +v.toPrecision(3)]));
  const { W, H, w, h } = d.size;
  const I = d.images, nat = d.native, p = d.params;
  const out = [];
  const scale = (W / w).toFixed(1);

  out.push(step(1, "s-prep", "prep", "Thu nhỏ về 256 px, chuyển mức xám",
    `${W}×${H} thành ${w}×${h}, ít hơn ${Math.round((W * H) / (w * h))} lần số điểm ảnh.`,
    fig({ src: I.input, w: W, h: H, caption: `Ảnh vào ${W}×${H}` }) +
    fig({ src: I.work, w, h, caption: `Ảnh làm việc ${w}×${h}` }) +
    fig({ src: I.gray, w, h, caption: `Mức xám. Độ nét ${num(d.stats.sharpness, 0)}, độ lệch chuẩn ${num(d.stats.std, 1)}` }),
    {
      explain: `<p>Ảnh từ camera có hàng triệu điểm ảnh, nhưng để biết tờ giấy nằm ở đâu thì không cần nhiều như vậy. Bước đầu tiên thu ảnh về cạnh dài ${p.work_side} px rồi bỏ màu, chỉ giữ độ sáng. Mọi bước sau làm trên ảnh nhỏ này nên cả thuật toán chỉ mất vài mili giây.</p>
<p>Ở đây cũng đo hai con số. <b>Độ lệch chuẩn</b> cho biết ảnh có đủ chỗ sáng chỗ tối khác nhau không. <b>Độ nét</b> cho biết ảnh có bị nhòe không. Nếu cả ảnh gần như một màu (camera bị che, phòng quá tối) thì không có mép giấy nào để tìm, thuật toán dừng ngay và app báo thiếu sáng.</p>`,
      get: `Ảnh nhỏ, cùng một cỡ cho mọi ảnh vào. Ảnh quá phẳng (độ lệch chuẩn dưới ${p.low_contrast_std}) dừng ngay.`,
      use: `<code>resize</code> (INTER_AREA), <code>cvtColor</code>, <code>Laplacian</code>`,
      reason: `Mép giấy là chi tiết lớn, ở 256 px vẫn rõ còn chữ thì mờ đi. Mỗi điểm ảnh ở đây bằng ${scale}×${scale} điểm gốc, độ chính xác được bù ở bước 9.`,
    }));
  if (d.stats.lowContrast) {
    out.push(`<div class="kb-note">Ảnh này dừng ở bước 1 vì độ lệch chuẩn ${num(d.stats.std, 1)} nhỏ hơn ${p.low_contrast_std}.</div>`);
    return out.join("");
  }

  out.push(step(2, "s-close", "prep", "Xóa chữ, giữ mép giấy",
    "Phóng to một vùng giữa trang: nét chữ bị lấp, mép giấy vẫn nguyên.",
    fig({ src: I.zoomGray, w: 288, h: 288, pixel: true, caption: "Trước (phóng to 6 lần)" }) +
    fig({ src: I.zoomSmooth, w: 288, h: 288, pixel: true, caption: "Sau khi đóng hình thái" }) +
    fig({ src: I.smooth, w, h, caption: "Cả ảnh sau bước này" }),
    {
      explain: `<p>Chữ in trên trang là những nét tối, mảnh và dày đặc. Với bước tìm đường thẳng phía sau, mỗi dòng chữ trông như một đoạn thẳng ngắn, tạo ra rất nhiều nhiễu. Bước này lấp các nét tối nhỏ bằng màu giấy xung quanh.</p>
<p>Cách làm là <b>đóng hình thái</b> (closing), gồm hai lượt. Lượt một: mỗi điểm lấy giá trị sáng nhất trong một vùng tròn nhỏ quanh nó, nên nét chữ mảnh hơn vùng tròn bị phủ trắng. Lượt hai: lấy giá trị tối nhất để trả các mảng lớn về đúng kích thước cũ. Kết quả là vật nhỏ hơn vùng tròn biến mất, còn ranh giới giữa tờ giấy và mặt bàn là mảng lớn nên vẫn ở nguyên chỗ.</p>`,
      get: "Ảnh xám sạch: trong trang gần như một màu, mép trang vẫn sắc.",
      use: `<code>morphologyEx</code> CLOSE, ellipse ${p.close_kernel}×${p.close_kernel}, ${p.close_iterations} lần`,
      reason: "Làm mờ cũng xóa được chữ nhưng nhòe luôn mép trang. Đóng hình thái chỉ xóa nét tối nhỏ hơn kernel.",
    }));

  const lineSvg = segs(d.lines.map((l) => l.pts), w, h, "var(--b)", 2.2);
  out.push(step(3, "s-lines", "cand", "Tìm đoạn thẳng, gộp thành đường dài",
    `${d.segments.length} đoạn thẳng gộp lại còn <b>${d.lines.length}</b> đường.`,
    fig({ src: I.smooth, w, h, svg: segs(d.segments, w, h, "var(--lines)", 1.4), caption: `${d.segments.length} đoạn LSD` }) +
    fig({ src: I.work, w, h, svg: lineSvg, caption: `${d.lines.length} đường sau khi gộp` }),
    {
      explain: `<p>Nhìn từ camera, mép tờ giấy là bốn đoạn thẳng nơi độ sáng đổi đột ngột. Bước này dùng <b>LSD</b> (Line Segment Detector) để tìm các đoạn thẳng ngắn ở những chỗ độ sáng thay đổi theo cùng một hướng.</p>
<p>Kết quả LSD thường vụn: một mép giấy bị cắt thành nhiều khúc vì ngón tay, bóng đổ, hay chỗ mép trùng màu nền. Vì vậy các đoạn cùng hướng và nằm gần trên một đường được <b>gộp</b> thành một đường dài. Mỗi đường nhớ thêm <b>độ phủ</b>: bao nhiêu phần chiều dài thật sự có đoạn thẳng nằm trên. Đường quá ngắn hoặc phủ quá ít bị bỏ, chỉ giữ tối đa ${p.max_lines} đường tốt nhất.</p>`,
      get: "Các đường dài, mỗi đường nhớ cả những khúc thật sự có biên.",
      use: `LSD của OpenCV. Gộp khi lệch hướng ≤ ${p.merge_angle} rad và cách đường ≤ ${p.merge_dist} px.`,
      reason: "Mép trang thường bị ngắt quãng bởi ngón tay, bóng, chữ sát mép. Gộp lại mới ra một đường đáng tin.",
    }));

  const lineCands = d.candidates.filter((c) => c.source === "lines").slice(0, 12);
  out.push(step(4, "s-quads", "cand", "Ghép bốn đường thành tứ giác",
    `${d.lineCandidates} tứ giác hợp lệ. Hình vẽ ${Math.min(12, d.lineCandidates)} cái tốt nhất.`,
    fig({ src: I.work, w, h, svg: lineSvg.replace(/stroke-width="2.2"/g, 'stroke-width="1" stroke-opacity=".5"') + lineCands.map((c, k) => poly(c.quad, w, h, `hsl(${(k * 47) % 360} 85% 55%)`, 'stroke-width="1.6"')).join(""), caption: "Mỗi màu là một tứ giác ứng viên" }),
    {
      explain: `<p>Tờ giấy chụp nghiêng vẫn có hai cặp cạnh đối gần song song. Bước này thử ghép các đường: lấy hai đường gần song song làm một cặp, hai đường khác làm cặp còn lại, rồi lấy bốn giao điểm làm bốn góc.</p>
<p>Với ${d.lines.length} đường có rất nhiều cách ghép, phần lớn vô nghĩa. Các luật hình học rẻ được kiểm trước: hai cạnh đối gần song song và cách nhau đủ xa, hai cặp gần vuông góc, tứ giác lồi, đủ lớn, góc không văng quá xa ra ngoài ảnh. Tứ giác qua hết các luật mới thành ứng viên, giữ tối đa ${p.prescore_keep} cái và ưu tiên cái lớn.</p>`,
      get: "Các tứ giác lồi tạo bởi hai cặp cạnh đối gần song song.",
      use: `Luật hình học: gần song song (≤ ${p.parallel_tol} rad), đủ xa nhau, đủ vuông, diện tích ≥ ${pct(p.min_area_ratio)} ảnh.`,
      reason: "Loại nhanh hàng nghìn tổ hợp vô nghĩa trước khi phải chấm điểm tốn thời gian.",
    }));

  const R = d.regions;
  const regionFig = (name, title) => {
    const ks = R[name] || [];
    const svg = ks.map((k) => (k.quad ? poly(k.quad, w, h, "var(--good)", 'stroke-width="2.5"') : "")
      + `<polyline points="${P(k.contour, w, h)}" style="stroke:var(--bad);fill:none" stroke-width="1.2" stroke-dasharray="3 2"/>`).join("");
    const note = ks.length ? (ks.some((k) => !k.why) ? "có ứng viên" : `loại (${ks.map((k) => k.why).join(", ")})`) : "không có vùng đủ lớn";
    return fig({ src: I[`mask_${name}`], w, h, svg, pixel: true, caption: `${title}: ${note}` });
  };
  out.push(step(5, "s-regions", "cand", "Tìm ứng viên theo vùng màu",
    "Vùng trắng là vùng được chọn. Viền đỏ là đường bao, xanh là tứ giác được nhận.",
    fig({ src: I.colorDist, w, h, caption: "Khác màu nền (sáng là khác nhiều)" }) +
    regionFig("color", "Khác màu nền") + regionFig("bright", "Vùng sáng") + regionFig("dark", "Vùng tối"),
    {
      explain: `<p>Có những ảnh mép giấy không thành đường thẳng rõ: giấy trắng trên bàn trắng, mép bị bóng che, giấy hơi cong. Khi đó nhìn theo <b>vùng</b> lại dễ hơn, vì tờ giấy là một mảng màu khác với nền xung quanh.</p>
<p>Màu nền được ước lượng từ một dải sát mép ảnh, vì mép ảnh thường là mặt bàn. Mỗi điểm được đo khác màu nền bao nhiêu trong không gian màu <b>Lab</b>, gần với cách mắt người cảm nhận màu. Sau đó <b>ngưỡng Otsu</b> tự chia ảnh thành phần giống nền và phần khác nền. Ngoài ra còn thử hai cách chia đơn giản hơn: vùng sáng và vùng tối. Mỗi vùng lớn được lấy đường bao rồi xấp xỉ thành đa giác 4 đỉnh.</p>
<p>Vùng phải lấp gần kín tứ giác của nó (82% đến 118%). Nếu không, đó thường là một vật có hình dạng khác hoặc nhiều vật dính vào nhau.</p>`,
      get: "Thêm ứng viên khi mép giấy không thành đường thẳng rõ.",
      use: "Lab, ngưỡng Otsu, <code>findContours</code>, <code>approxPolyDP</code> ra đúng 4 đỉnh.",
      reason: "Otsu tự chọn ngưỡng cho từng ảnh. Vùng phải lấp gần kín tứ giác (82 đến 118%) để loại vật không giống tờ giấy.",
    }));

  const edgeCands = d.candidates.filter((c) => c.source === "edges");
  out.push(step(6, "s-edges", "cand", "Tìm ứng viên theo biên khép kín",
    `Biên Canny ở hai mức nhạy, được ${edgeCands.length} ứng viên.`,
    fig({ src: I.canny20, w, h, pixel: true, svg: edgeCands.slice(0, 6).map((c) => poly(c.quad, w, h, "var(--good)", 'stroke-width="2"')).join(""), caption: "Canny nhạy (20/60)" }) +
    fig({ src: I.canny50, w, h, pixel: true, caption: "Canny chặt (50/150)" }),
    {
      explain: `<p><b>Canny</b> tìm biên mảnh một điểm ảnh ở mọi nơi độ sáng đổi mạnh. Nếu mép giấy tạo thành một đường biên khép kín thì chỉ cần lấy đường bao đó và xấp xỉ thành 4 đỉnh, không cần qua bước ghép đường thẳng. Cách này bắt được mép hơi cong và góc bo tròn mà bước đường thẳng có thể bỏ sót.</p>
<p>Canny cần ngưỡng: thấp quá thì vân gỗ, chữ cũng thành biên; cao quá thì mép mờ bị đứt. Không có ngưỡng nào hợp mọi ảnh nên chạy cả hai mức, nối các chỗ đứt nhỏ rồi mới tìm đường bao.</p>`,
      get: "Ứng viên từ đường biên khép kín, bắt được mép hơi cong hoặc góc bo.",
      use: "<code>Canny</code>, nối biên đứt, <code>findContours</code>, <code>approxPolyDP</code>",
      reason: "Ba nguồn bù cho nhau. Không có ngưỡng Canny nào hợp mọi ánh sáng nên dùng hai.",
    }));

  const top = d.candidates.slice(0, 8);
  const win = d.candidates.find((c) => c.i === d.best);
  const sampleColor = { edge: "var(--good)", none: "var(--bad)", border: "var(--muted)" };
  const samples = (d.mirror.samples || []).map(([x, y, s]) => `<circle cx="${x * w}" cy="${y * h}" r="1.6" style="fill:${sampleColor[s]}"/>`).join("");
  out.push(step(7, "s-score", "score", "Chấm điểm mọi ứng viên",
    `${d.candidates.length} ứng viên, cùng một thước đo. Rê chuột lên bảng để xem từng cái.`,
    fig({ src: I.gradient, w, h, caption: "Độ mạnh của biên (Sobel)" }) +
    fig({ src: I.work, w, h, svg: (win ? poly(win.quad, w, h, "var(--b)", 'stroke-width="1" stroke-opacity=".6"') : "") + samples, caption: "Điểm mẫu trên cạnh: xanh có biên, đỏ không có" }) +
    candidateTable(top, d, w, h),
    {
      explain: `<p>Đến đây có ${d.candidates.length} ứng viên từ ba nguồn. Mỗi nguồn tự tin theo kiểu riêng nên không so trực tiếp được. Bước này chấm mọi ứng viên bằng cùng một thước đo, chỉ dựa trên bằng chứng nhìn thấy trong ảnh.</p>
<p>Dọc mỗi cạnh lấy các điểm mẫu cách đều nhau. Ở mỗi điểm hỏi hai câu:</p>
<ul><li><b>Có biên không?</b> Tìm trong khoảng ±${p.edge_window} px vuông góc với cạnh xem có chỗ độ sáng đổi mạnh (đo bằng Sobel) không. Tỉ lệ điểm có biên gọi là <b>độ phủ</b>.</li>
<li><b>Hai bên có khác màu không?</b> Lấy màu cách cạnh ${p.contrast_offset} px ở phía trong và phía ngoài rồi đo chênh lệch. Mép giấy thật thì một bên là giấy, một bên là nền. Con số này gọi là <b>tương phản</b>.</li></ul>
<p>Điểm một cạnh là độ phủ nhân tương phản. Điểm tứ giác gộp bốn cạnh, trong đó cạnh yếu nhất chiếm 35%: tứ giác chỉ có hai cạnh thật (ví dụ hai mép giấy ghép với hai vệt bóng) bị kéo điểm xuống. Cạnh nằm sát mép ảnh vẫn được tính một phần, vì tờ giấy có thể bị khung hình cắt mất.</p>`,
      get: "Mỗi cạnh có độ phủ (bao nhiêu phần nằm trên biên thật) và độ tương phản (hai bên khác màu không).",
      use: "Sobel, Lab. Điểm cạnh = phủ × tương phản, rồi gộp 4 cạnh.",
      reason: "Ứng viên từ mọi nguồn được so bằng bằng chứng trên ảnh. Cạnh yếu nhất bị tính nặng để chặn tứ giác chỉ có 2 cạnh thật.",
    }));

  out.push(step(8, "s-pick", "score", "Chọn tờ giấy ngoài cùng",
    win ? `Thắng: ứng viên từ ${SOURCE_NAME[win.source]}, điểm ${num(win.score)}, hạng ${num(win.rank)}.` : `Không ứng viên nào đạt ${p.min_score} điểm, kết quả là không tìm thấy.`,
    scoreBreakdown(win, d, w, h),
    {
      explain: `<p>Ứng viên điểm cao nhất chưa chắc là tờ giấy. Trên một trang tạp chí, bức ảnh in bên trong hay khung bảng cũng là hình chữ nhật có mép rõ, đôi khi còn rõ hơn mép giấy. Nếu chỉ chọn điểm cao nhất, app sẽ hay khoanh nhầm vào phần bên trong.</p>
<p>Vì vậy ứng viên được xếp theo <b>hạng</b> = điểm × căn bậc bốn của diện tích. Căn bậc bốn tăng chậm: lớn gấp 16 lần chỉ được lợi gấp 2. Như vậy đủ để trang ngoài cùng thắng khi điểm gần bằng nhau, nhưng một vùng lớn mà mép mờ vẫn không thắng được. Ứng viên cũng phải có điểm từ ${p.min_score} trở lên; không cái nào đạt thì trả về không tìm thấy thay vì đoán bừa.</p>`,
      get: "Một tứ giác, hoặc không tìm thấy.",
      use: `Điểm ≥ ${p.min_score}, xếp hạng theo điểm × diện tích<sup>¼</sup>.`,
      reason: "Trên trang in có ảnh, bảng, khung chữ cũng là hình chữ nhật rõ nét. Thêm diện tích để trang ngoài cùng thắng.",
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
        caption: "Phóng to một góc: cam là trước, xanh là sau" });
    }
    const moved = Math.max(...m.corners.map((q, i) => Math.hypot((q[0] - m.before[i][0]) * w, (q[1] - m.before[i][1]) * h)));
    out.push(step(9, "s-refine", "score", "Tinh chỉnh bốn cạnh",
      m.refined ? `Góc dịch nhiều nhất ${num(moved, 2)} px.` : `Giữ nguyên vì ${esc(m.refineReason)}.`,
      zoomFig + fig({ src: I.gray, w, h, svg: poly(m.before, w, h, "var(--b)", 'stroke-width="1.5"') + poly(m.corners, w, h, "var(--good)", 'stroke-width="1.5"') + dots((m.refinePoints || []).flat(), w, h, "var(--lines)", 1.1), caption: "Vàng là các điểm biên tìm được" }),
      {
        explain: `<p>Các bước trước làm trên ảnh ${w}×${h} đã xóa chữ, nên góc có thể lệch 1 đến 2 điểm ảnh. Nghe thì nhỏ, nhưng mỗi điểm ở đây bằng ${scale} điểm trên ảnh gốc, đủ để chữ sát mép bị cắt hoặc ảnh nắn bị xiên.</p>
<p>Bước này đi dọc từng cạnh, ở mỗi vị trí tìm chỗ biên mạnh nhất trên ảnh xám chưa xóa chữ (các điểm vàng trong hình). Sau đó khớp một đường thẳng qua các điểm này bằng <b>Huber</b>, cách khớp ít bị kéo lệch bởi vài điểm sai như điểm rơi vào ngón tay. Bốn đường mới cắt nhau cho bốn góc mới. Nếu không đủ điểm hoặc có góc phải dời quá 5 px thì coi là không chắc và giữ kết quả cũ.</p>`,
        get: "Góc chính xác hơn một điểm ảnh. Sai 1 px ở đây là sai khoảng " + scale + " px trên ảnh gốc.",
        use: "Sobel trên ảnh xám gốc, khớp đường bằng <code>fitLine</code> (Huber).",
        reason: "Bước xóa chữ có thể dời mép 1 px. Chỉ nhận khi đủ điểm biên và góc dịch không quá 5 px, nếu không giữ kết quả cũ.",
      }));
  }

  out.push(step(10, "s-result", "out", "Kết quả và ảnh nắn phẳng",
    nat.found ? `Thư viện C++ tìm thấy (nguồn ${SOURCE_NAME[nat.method] || nat.method}), điểm ${num(nat.score)}, độ tin cậy ${num(nat.confidence, 2)}.` : `Thư viện C++ trả về: không tìm thấy.`,
    fig({ src: I.input, w: W, h: H, svg: (d.source.gt ? poly(d.source.gt, W, H, "var(--gt)", 'stroke-dasharray="10 7" stroke-width="2"') : "") + (nat.corners ? poly(nat.corners, W, H, "var(--b)", 'stroke-width="3"') + dots(nat.corners, W, H, "var(--b)", Math.max(W, H) * 0.008) : ""), caption: `Cam là kết quả${d.source.gt ? ", xanh đứt là nhãn đúng" : ""}` }) +
    (I.warp ? `<figure class="xfig"><img class="warp" src="${I.warp}" alt="Ảnh nắn phẳng"><figcaption>Ảnh nắn phẳng</figcaption></figure>` : ""),
    {
      explain: `<p>Bốn góc được sắp theo thứ tự cố định: trên trái, trên phải, dưới phải, dưới trái. Từ bốn góc tính ra một <b>phép biến đổi phối cảnh</b> (ma trận 3×3) đưa tứ giác nghiêng về hình chữ nhật, như thể chụp thẳng từ trên xuống. Chiều rộng và chiều cao ảnh ra lấy theo cạnh dài hơn của mỗi cặp cạnh đối.</p>
<p><b>Độ tin cậy</b> là điểm chia cho ${p.confidence_full}, tối đa là 1. Trong app, bốn góc được dùng để vẽ khung trên màn camera; ảnh nắn phẳng chỉ được tạo khi người dùng bấm chụp.</p>`,
      get: "Bốn góc theo thứ tự trên trái, trên phải, dưới phải, dưới trái.",
      use: "<code>getPerspectiveTransform</code> và <code>warpPerspective</code>",
      reason: d.mirror.matches
        ? `Ảnh minh họa ở trên được tạo lại bằng Python với cùng hàm và tham số, khớp kết quả C++ trên ảnh này.`
        : `Ảnh minh họa ở trên tạo lại bằng Python và <b>lệch kết quả C++</b> ở ảnh này, chỉ nên xem gần đúng.`,
    }));
  return out.join("");
}

function candidateTable(top, d, w, h) {
  const bars = (vals) => `<span class="mini-bars">${vals.map((v) => `<i style="--v:${Math.max(0.04, v)}" title="${num(v, 2)}"></i>`).join("")}</span>`;
  const rows = top.map((c, k) => {
    const cls = c.i === d.best && c.score >= d.params.min_score ? "win" : c.score < d.params.min_score ? "below" : "";
    return `<tr data-cand="${k}" class="${cls}"><td>${k + 1}</td><td>${SOURCE_NAME[c.source]}</td><td>${bars(c.coverage)}</td><td>${bars(c.contrast)}</td>
      <td>${pct(c.area)}</td><td><b>${num(c.score)}</b>${c.penalized ? ' <span class="badge bad" title="có cạnh gần như không có biên">phạt</span>' : ""}</td><td>${num(c.rank)}</td></tr>`;
  }).join("");
  const svg = top.map((c, k) => poly(c.quad, w, h, c.i === d.best ? "var(--b)" : "var(--a)", `data-cand="${k}" class="cand" stroke-width="${c.i === d.best ? 2.5 : 1.2}"`)).join("");
  return `<div class="cand-wrap">${fig({ src: d.images.work, w, h, svg, caption: "8 ứng viên hạng cao nhất" })}
    <div class="scroll"><table class="table cand-table"><thead><tr><th>#</th><th>Nguồn</th><th>Phủ 4 cạnh</th><th>Tương phản</th><th>Diện tích</th><th>Điểm</th><th>Hạng</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="cand-legend"><span class="sw win"></span>được chọn &nbsp; <span class="sw below"></span>dưới ngưỡng ${d.params.min_score}</p></div></div>`;
}

function scoreBreakdown(c, d, w, h) {
  if (!c) return `<p class="kb-muted">Xem bảng ứng viên ở bước 7.</p>`;
  const q = c.quad.map(([x, y]) => [x * w, y * h]);
  const len = q.map((p, i) => Math.hypot(q[(i + 1) % 4][0] - p[0], q[(i + 1) % 4][1] - p[1]));
  const side = c.coverage.map((v, i) => v * c.contrast[i]);
  const mean = side.reduce((s, v, i) => s + v * len[i], 0) / len.reduce((a, b) => a + b, 0);
  const minSide = Math.min(...side);
  const overall = 0.65 * mean + 0.35 * minSide;
  const size = 0.85 + 0.15 * Math.min(1, c.area / 0.5);
  const names = ["Trên", "Phải", "Dưới", "Trái"];
  return `<div class="score-break">
    <table class="table"><thead><tr><th>Cạnh</th><th>Phủ</th><th>Tương phản</th><th>Điểm cạnh</th></tr></thead><tbody>
    ${names.map((n, i) => `<tr><th>${n}</th><td>${num(c.coverage[i], 2)}</td><td>${num(c.contrast[i], 2)}</td><td><b>${num(side[i], 2)}</b></td></tr>`).join("")}</tbody></table>
    <pre><code>tổng  = 0,65 × trung bình ${num(mean)} + 0,35 × cạnh yếu nhất ${num(minSide)} = ${num(overall)}
điểm  = tổng × đồng nhất màu ${num(c.consistency)} × diện tích ${num(size)}${c.penalized ? " × 0,5 (phạt)" : ""} = <b>${num(c.score)}</b>
hạng  = điểm × ${pct(c.area)}^0,25 = <b>${num(c.rank)}</b></code></pre></div>`;
}

// ------------------------------------------------------------------ các phần khác

function measurements(report) {
  if (!report) return `<p>Chưa có báo cáo trong <code>Core/reports/v3-validation.json</code>.</p>`;
  const rows = Object.entries(report.datasets).map(([ds, versions]) => {
    const a = versions.v2, b = versions.v3;
    if (!a || !b) return "";
    const pair = (key, format) => a[key] == null && b[key] == null ? "<td>n/a</td>" : `<td>${format(a[key])} → <b>${format(b[key])}</b></td>`;
    return `<tr><th>${esc(ds)}</th>${pair("meanIoU", (v) => num(v))}${pair("success", pct)}${pair("falsePositive", pct)}${pair("msMedian", (v) => num(v, 1))}</tr>`;
  }).join("");
  return `${report.matchesSources ? "" : '<div class="kb-note">Mã C++ đã đổi so với lần đo. Cần đo lại.</div>'}
    <div class="scroll"><table class="table"><thead><tr><th>Bộ dữ liệu</th><th>Độ khớp IoU ↑</th><th>Tỷ lệ IoU ≥ 0,9 ↑</th><th>Báo nhầm ↓</th><th>ms ↓</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="kb-muted">Mỗi ô ghi v2 → v3, ảnh ${report.size} px, máy tính, 1 luồng. "n/a" là bộ không có ảnh âm. Đo ngày ${esc(new Date(report.createdAt).toLocaleDateString("vi-VN"))}.</p>`;
}

function examples(rows) {
  if (!rows?.length) return "";
  return `<h3>Ví dụ tăng và giảm nhiều nhất</h3>
    <p class="kb-muted">Xanh lá là nhãn đúng, xanh dương là v2, cam là v3.</p>
    <div class="algorithm-examples">${rows.map((r) => {
      const url = `/api/datasets/${encodeURIComponent(r.dataset)}/images/${encodeURIComponent(r.id)}?thumb=1`;
      return `<figure class="card"><figcaption><b>${esc(r.dataset)}</b>, ${r.kind === "gain" ? "tăng" : "giảm"}: IoU ${num(r.iou2)} → ${num(r.iou3)}</figcaption>
        <div class="algorithm-example-pair">${["v2", "v3"].map((v) => `<div><b>${v}${r[v] ? "" : " (không thấy)"}</b><div class="frame">${shot({src: url, w: r.width, h: r.height, layers: [{pts: r.gt, color: COLORS.gt, dash: true}, {pts: r[v], color: v === "v2" ? COLORS.a : COLORS.b}], alt: `${r.dataset} ${v}`})}</div></div>`).join("")}</div>
        <a class="btn sm" href="/d/${encodeURIComponent(r.dataset)}/i/${encodeURIComponent(r.id)}?run=v3@256&vs=v2@256">Mở ảnh</a></figure>`;
    }).join("")}</div>`;
}

const V2V3 = [
  ["Ứng viên từ đường thẳng", "30", "60, ưu tiên cái lớn", "Mép trang lớn không bị ô chữ nhật nhỏ đẩy ra"],
  ["Vùng không ra 4 đỉnh", "Lấy hình chữ nhật bao", "Bỏ, thêm điều kiện lấp đầy", "Bớt báo nhầm"],
  ["Ứng viên từ Canny", "Không có", "Có", "Bắt mép cong nhẹ, góc bo"],
  ["Phạt trang nhiều màu", "40%", "20%", "Bìa, thẻ không bị loại oan"],
  ["Cạnh không có biên", "Không xét", "Điểm × 0,5", "Chặn tứ giác chỉ có 2 cạnh thật"],
  ["Chọn kết quả", "Điểm cao nhất, ngưỡng 0,30", "Điểm × diện tích¼, ngưỡng 0,40", "Ưu tiên trang ngoài, bớt báo nhầm"],
  ["Tinh chỉnh góc", "Không có", "fitLine, tối đa 5 px", "Góc chuẩn hơn khi nắn phẳng"],
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
  const parameterRows = PARAMS.map(([key, text]) => {
    const x = a.params?.[key], y = b.params?.[key];
    return `<tr${x !== y ? ' class="param-changed"' : ""}><th><code>${key}</code></th><td>${num(x)}</td><td>${num(y)}</td><td>${text}</td></tr>`;
  }).join("");
  const cur = d.source;
  const picker = d.examples.map((e) => {
    const on = e.dataset === cur.dataset && e.id === cur.id;
    return `<a class="chip${on ? " on" : ""}" href="/algorithms?ds=${encodeURIComponent(e.dataset)}&id=${encodeURIComponent(e.id)}">${esc(e.title)}</a>`;
  }).join("");
  const link = (id, t) => `<a href="/algorithms${location.search}#${id}">${t}</a>`;
  const mc = d.mirrorCheck;

  main.innerHTML = `<article class="kb">
    <header class="kb-hero"><h1>Thuật toán nhận diện tài liệu v3</h1>
      <p>Tìm bốn góc của tờ giấy trong một ảnh bằng xử lý ảnh cổ điển. Viết bằng C++ với OpenCV, không dùng AI.</p></header>
    <nav class="kb-toc"><a href="/algorithms${location.search}#idea">Ý tưởng</a><a href="/algorithms${location.search}#s-prep">Từng bước</a>
      <a href="/algorithms${location.search}#v2v3">v2 và v3</a><a href="/algorithms${location.search}#validation">Kết quả đo</a>
      <a href="/algorithms${location.search}#limits">Giới hạn</a><a href="/algorithms${location.search}#parameters">Tham số</a></nav>

    <section class="kb-sec" id="idea"><h2>Ý tưởng</h2>
      <p class="lead">Sinh thật nhiều ứng viên, chấm thật chặt, chọn tờ ngoài cùng.</p>
      <div class="kb-explain">
        <p>Đầu vào là một ảnh chụp bất kỳ. Đầu ra là <b>bốn góc</b> của tờ giấy trong ảnh, hoặc câu trả lời "không thấy". Có bốn góc thì app vẽ được khung lên màn camera, và khi chụp thì kéo tờ giấy nghiêng về hình chữ nhật phẳng như máy scan.</p>
        <p>Khó ở chỗ ảnh thật rất lộn xộn: chữ in, ảnh minh họa, vân gỗ, bóng đổ, ngón tay đè lên mép. Không có một dấu hiệu duy nhất nào luôn đúng. Vì vậy v3 không cố tìm ngay câu trả lời, mà <b>đề xuất nhiều tứ giác</b> bằng ba cách khác nhau, rồi <b>kiểm tra từng cái</b> trên ảnh xem mép có thật không. Cách nào bỏ sót thì cách khác bù lại; cái nào sai thì bị bước chấm điểm loại.</p>
        <p>Thuật toán dùng xử lý ảnh cổ điển của OpenCV, không dùng mạng nơ-ron. Nhờ vậy nó nhỏ, đủ nhẹ để chạy liên tục trên từng khung camera (khoảng 10 ms trên máy tính), và mỗi quyết định đều giải thích được như trang này đang làm.</p>
      </div>
      <div class="kb-ideas">
        <div class="kb-idea ph-cand"><b>1. Sinh ứng viên</b><span>Tứ giác từ ba nguồn: đường thẳng, vùng màu, biên khép kín.</span></div>
        <div class="kb-idea ph-score"><b>2. Chấm điểm</b><span>Bốn cạnh có nằm trên biên rõ và hai bên có khác màu không.</span></div>
        <div class="kb-idea ph-out"><b>3. Chọn</b><span>Tờ giấy ngoài cùng đủ điểm. Không có thì báo không thấy.</span></div>
      </div>
      <div class="kb-flow">
        <div class="kb-phase ph-prep"><b>Chuẩn bị</b>${link("s-prep", "1. Thu nhỏ")}${link("s-close", "2. Xóa chữ")}</div>
        <div class="kb-phase ph-cand"><b>Tìm ứng viên</b>${link("s-lines", "3. Đường thẳng")}${link("s-quads", "4. Tứ giác")}${link("s-regions", "5. Vùng màu")}${link("s-edges", "6. Biên")}</div>
        <div class="kb-phase ph-score"><b>Chấm và chọn</b>${link("s-score", "7. Chấm điểm")}${link("s-pick", "8. Chọn")}${link("s-refine", "9. Tinh chỉnh")}</div>
        <div class="kb-phase ph-out"><b>Kết quả</b>${link("s-result", "10. Nắn phẳng")}</div>
      </div>
      <dl class="kb-glossary">
        <div><dt>Ứng viên</dt><dd>Một tứ giác có thể là tờ giấy. Một ảnh thường có vài chục ứng viên, chỉ một cái được chọn.</dd></div>
        <div><dt>Biên</dt><dd>Chỗ độ sáng đổi đột ngột giữa hai điểm ảnh cạnh nhau, ví dụ giữa giấy trắng và bàn gỗ.</dd></div>
        <div><dt>Lab</dt><dd>Cách biểu diễn màu gần với mắt người: L là độ sáng, a và b là sắc màu. Hai màu cách xa trong Lab thì nhìn khác nhau rõ.</dd></div>
        <div><dt>IoU</dt><dd>Phần giao chia phần hợp của hai tứ giác. Dùng để chấm kết quả so với nhãn đúng: 1 là trùng khít.</dd></div>
      </dl>
      <div class="kb-picker"><span class="kb-muted">Chọn ảnh minh họa cho các bước bên dưới:</span>${picker}</div>
    </section>

    ${stepsHtml(d)}

    <section class="kb-sec ph-extra" id="v2v3" style="--c:var(--c-violet)"><h2>v2 và v3 khác gì</h2>
      <p class="lead">v3 được tách từ v2 thành thư viện riêng để so sánh song song trên cùng ảnh.</p>
      <div class="kb-explain"><p>v2 chỉ có hai nguồn ứng viên và chọn theo điểm cao nhất. Lỗi hay gặp nhất của v2 là khoanh vào một hình chữ nhật nhỏ bên trong trang (ảnh, bảng), và báo nhầm trên ảnh không có tài liệu. Các thay đổi của v3 nhắm thẳng vào hai lỗi đó: thêm nguồn ứng viên để không bỏ sót mép trang, chấm chặt hơn để bớt báo nhầm, và ưu tiên tờ ngoài cùng khi chọn.</p></div>
      <div class="scroll"><table class="table"><thead><tr><th>Phần</th><th>v2</th><th>v3</th><th>Để làm gì</th></tr></thead><tbody>
      ${V2V3.map((r) => `<tr><th>${r[0]}</th><td>${r[1]}</td><td><b>${r[2]}</b></td><td>${r[3]}</td></tr>`).join("")}</tbody></table></div>
    </section>

    <section class="kb-sec" id="validation" style="--c:var(--c-green)"><h2>Kết quả đo</h2>
      <p class="lead">Trên tập kiểm tra tách riêng khỏi tập phát triển.</p>
      <div class="kb-explain"><p>Tham số được chỉnh trên một tập ảnh, rồi đo trên một tập khác chưa từng dùng khi chỉnh, để con số không bị đẹp giả. Cách đọc bảng: <b>độ khớp IoU</b> càng gần 1 càng tốt; <b>tỷ lệ IoU ≥ 0,9</b> là phần ảnh có khung đủ chuẩn để nắn phẳng dùng được; <b>báo nhầm</b> là phần ảnh không có tài liệu mà vẫn trả về một khung, càng thấp càng tốt; <b>ms</b> là thời gian một lần detect.</p></div>
      ${measurements(data.validation)}${examples(data.examples)}
    </section>

    <section class="kb-sec" id="limits" style="--c:var(--c-red)"><h2>Giới hạn</h2>
      <ul class="kb-list">
        <li><b>Hình chữ nhật chưa chắc là tài liệu.</b> Thuật toán chỉ biết hình dạng và mép, không hiểu nội dung. Màn hình, khung tranh, mặt bàn, cửa sổ đều có bốn cạnh rõ nên vẫn có thể bị nhận. Đây là nguồn báo nhầm chính trên ảnh không có tài liệu.</li>
        <li><b>Nền nhiều đồ vật.</b> Khi quanh tờ giấy có sách, bút, dây điện, số đường thẳng tăng vọt và nhiều tứ giác giả có mép rõ không kém. Trong video SmartDoc, nền nhiều đồ vật là nơi v3 hụt nhiều nhất.</li>
        <li><b>Bóng đổ, phản sáng, giấy cong.</b> Bóng tạo ra biên giả, phản sáng xóa mất một đoạn mép, giấy cong làm mép không còn thẳng. Bước vùng màu và Canny bù được một phần, không phải tất cả.</li>
        <li><b>Mỗi lần detect độc lập.</b> Thuật toán không nhớ khung trước, nên trên video kết quả có thể nhảy giữa hai ứng viên gần điểm nhau. Làm khung ổn định qua nhiều khung hình là việc của Tracker, xem trang <a href="/video">Luồng video</a>.</li>
      </ul>
      ${mc ? `<p class="kb-muted">Ảnh minh họa tạo bằng bản Python (<code>detect/v3/mirror.py</code>). Trên ${mc.images} ảnh, cùng kết luận với C++ ở ${mc.sameFound} ảnh, góc lệch dưới 0,5% ở ${mc.cornersWithin05pct}/${mc.bothFound} ảnh.</p>` : ""}
    </section>

    <section class="kb-sec" id="parameters" style="--c:var(--c-teal)"><h2>Tham số</h2>
      <p class="lead">Đọc trực tiếp từ thư viện đang chạy. Hàng tô màu là chỗ v2 và v3 khác nhau.</p>
      ${!a.available || !b.available ? '<div class="kb-note">Một thư viện chưa được build.</div>' : ""}
      <details><summary>Xem bảng ${PARAMS.length} tham số</summary>
        <div class="scroll"><table class="table"><thead><tr><th>Tham số</th><th>v2</th><th>v3</th><th>Ý nghĩa</th></tr></thead><tbody>${parameterRows}</tbody></table></div></details>
      <details><summary>Lệnh build và đo lại</summary><pre><code>.\\Core\\native\\docdetect_v3\\build.ps1
cd Core
.venv\\Scripts\\python.exe -m tools.compare_versions --phase validation --limit 600 --output reports/v3-validation.json
.venv\\Scripts\\python.exe -m tools.check_mirror --per-set 60</code></pre></details>
    </section>
  </article>`;

  const wrap = main.querySelector(".cand-wrap");
  const onHover = (e) => {
    const k = e.target.closest("tr[data-cand]")?.dataset.cand;
    wrap.classList.toggle("hovering", k != null);
    wrap.querySelectorAll("[data-cand]").forEach((el) => el.classList.toggle("hot", el.dataset.cand === k));
  };
  wrap?.addEventListener("mouseover", onHover);
  wrap?.addEventListener("mouseleave", onHover);
}
