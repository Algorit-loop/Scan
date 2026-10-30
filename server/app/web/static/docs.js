"use strict";

/* Tab "Tài liệu dự án": nạp docs.html một lần, rồi dựng các hình minh họa bằng JS. */
(function () {
  const $d = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    for (const c of kids.flat()) el.append(c instanceof Node ? c : document.createTextNode(c));
    return el;
  };
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  // ============ DỮ LIỆU ============
  const LAYERS = {
    api: "Server · API", det: "Server · Detect", infra: "Server · Hạ tầng",
    web: "Web admin", app: "App", test: "Kiểm thử",
  };

  const MODULES = [
    // --- API ---
    { id: "main", layer: "api", name: "main.py", file: "app/main.py",
      does: "Điểm vào của server: khởi tạo FastAPI, gắn hai nhóm route và phục vụ file tĩnh của trang web.",
      how: ["<code>app.include_router(mobile.router)</code> và <code>web.router</code>.", "Mount <code>/static</code> trỏ vào <code>app/web/static</code>.", "Chạy bằng <code>uvicorn app.main:app --host 0.0.0.0 --port 8000</code> (xem run.ps1)."],
      io: "Không có logic xử lý ảnh — chỉ lắp ráp." },
    { id: "rweb", layer: "api", name: "routes/web.py", file: "app/routes/web.py",
      does: "API cho trang web kiểm tra: upload ảnh, chạy detect, lưu, liệt kê, xem, xóa.",
      how: ["<code>POST /api/detections</code>: body là <b>byte thô</b> của ảnh (không multipart, khỏi cần thư viện phụ); phiên bản và tên file ở query.", "Từ chối ảnh &gt; 40 MB (kiểm tra cả header <code>content-length</code> lẫn độ dài thực).", "Hàm <code>_run</code>: decode → detect → đo thời gian từng bước → <code>storage.save</code>. Chạy trong <code>run_in_threadpool</code> để không chặn event loop.", "Lỗi: phiên bản không có / ảnh hỏng → 400; id không tồn tại → 404."],
      io: "Vào: byte ảnh + version. Ra: bản ghi JSON (result, timingsMs, files)." },
    { id: "rmobile", layer: "api", name: "routes/mobile.py", file: "app/routes/mobile.py",
      does: "API cho app điện thoại: nhận diện theo thời gian thực qua WebSocket và nắn phẳng ảnh chụp.",
      how: ["<code>WS /ws</code>: app gửi <code>{seq, image(base64), version?}</code>; server trả <code>{seq, result, timings}</code>. Ảnh hỏng thì trả <code>{seq, error}</code> nhưng <b>giữ kết nối</b>.", "Bỏ trường <code>debug</code> trước khi gửi cho điện thoại cho nhẹ.", "<code>POST /warp</code>: nhận ảnh độ phân giải cao + đúng 4 góc, trả ảnh đã nắn phẳng (base64).", "<code>GET /health</code>: báo phiên bản OpenCV và các detector có sẵn — app dùng để biết server có chạy không."],
      io: "Vào: khung nhỏ base64 (WS) hoặc ảnh lớn + 4 góc (warp). Ra: 4 góc + độ tin cậy, hoặc ảnh phẳng." },

    // --- DETECT ---
    { id: "registry", layer: "det", name: "detection/__init__.py", file: "app/detection/__init__.py",
      does: "Registry các phiên bản detect; nơi duy nhất app/web biết có những phiên bản nào.",
      how: ["Dict <code>version → Detector</code>; <code>DEFAULT_VERSION = \"v1\"</code>.", "<code>get_detector(version)</code> báo lỗi rõ ràng kèm danh sách phiên bản đang có.", "<code>list_detectors()</code> cấp dữ liệu cho ô chọn phiên bản trên web.", "Thêm phiên bản = tạo package mới + một dòng <code>register(...)</code>."],
      io: "Vào: tên phiên bản. Ra: đối tượng Detector." },
    { id: "base", layer: "det", name: "detection/base.py", file: "app/detection/base.py",
      does: "Hợp đồng chung: mọi phiên bản phải trả kết quả cùng một định dạng.",
      how: ["<code>Detector</code> là Protocol: <code>version, name, description, detect(img)</code>.", "<code>found_result()</code> chuẩn hóa 4 góc về 0..1, tính <code>bbox</code>, <code>areaRatio</code>, <code>touches</code> (ngưỡng 1.5% sát mép) và kẹp <code>confidence</code> trong 0..1.", "<code>not_found(reason)</code> với lý do <code>none</code> hoặc <code>lowContrast</code>."],
      io: "Vào: 4 góc pixel + kích thước ảnh. Ra: dict JSON giữ nguyên định dạng app cũ." },
    { id: "v1", layer: "det", name: "v1/__init__.py", file: "app/detection/v1/__init__.py",
      does: "Bộ điều phối detect v1: chạy cả pipeline và quyết định khi nào dùng phương án dự phòng.",
      how: ["Thu nhỏ ảnh về cạnh dài 640 px (INTER_AREA).", "Độ lệch chuẩn xám &lt; 8 → trả ngay <code>lowContrast</code>.", "Làm mịn bằng closing 5×5 lặp 3 lần để xóa chữ trong trang → LSD → gộp thành đường.", "Ứng viên = từ đường + từ vùng màu/sáng/tối; chấm điểm lấy tốt nhất. Nếu &lt; 0.5 mới thêm GrabCut. Nếu &lt; 0.30 → không thấy.", "<code>confidence = min(1, score / 0.8)</code>; kèm <code>debug</code> (đường, số ứng viên, thời gian từng bước, chi tiết điểm)."],
      io: "Vào: ảnh BGR bất kỳ cỡ. Ra: found_result hoặc not_found." },
    { id: "lines", layer: "det", name: "v1/lines.py", file: "app/detection/v1/lines.py",
      does: "Tìm các đoạn thẳng rồi gộp những đoạn thẳng hàng thành đường dài, dù bị ngắt quãng.",
      how: ["Dùng <code>cv2.createLineSegmentDetector(LSD_REFINE_STD)</code>.", "Bỏ đoạn ngắn (&lt; 2% cạnh dài); sắp xếp theo độ dài giảm dần.", "Gộp tham lam: đoạn vào cụm nếu lệch góc ≤ 0.07 rad (~4°) và cách ≤ 3 px; sau mỗi lần thêm, khớp lại đường bằng moment có trọng số độ dài.", "Mỗi đường nhớ các <b>khoảng thật sự có cạnh</b> → vẫn đúng khi dây tai nghe đè lên mép, không cần contour khép kín.", "Bỏ đường phủ &lt; 7% cạnh dài (vòng gáy xoắn), giữ tối đa 24 đường."],
      io: "Vào: ảnh xám đã làm mịn. Ra: danh sách Line (điểm, hướng, pháp tuyến, khoảng phủ)." },
    { id: "quads", layer: "det", name: "v1/quads.py", file: "app/detection/v1/quads.py",
      does: "Sinh các tứ giác ứng viên: chính từ giao điểm các đường, dự phòng từ phân vùng nền/giấy.",
      how: ["<b>from_lines</b>: cần ≥ 4 đường; tính ma trận giao điểm; ghép <i>cặp cạnh đối</i> (song song ≤ 0.55 rad ≈ 31°, cách nhau ≥ 8%) rồi ghép hai cặp vuông góc (sin ≥ 0.77). 4 góc = giao của các cạnh kéo dài → chịu được góc gấp, góc bị che.", "Lọc: góc nằm trong ảnh ± 5%, lồi, diện tích ≥ 4%. Xếp theo độ phủ của đường lên chu vi, giữ 30.", "<b>from_regions</b>: màu nền = trung vị dải viền 5% → khoảng cách Lab → Otsu; thêm mask sáng và tối. Close/Open → contour lớn nhất → xấp xỉ 4 điểm (approxPolyDP, rồi minAreaRect).", "<b>from_grabcut</b>: ảnh 224 px, khung cách mép 5%, 3 vòng lặp; chậm nên chỉ chạy khi cần."],
      io: "Vào: danh sách đường / ảnh. Ra: list Candidate (4 góc, nguồn: lines|color|bright|dark|grabcut)." },
    { id: "scoring", layer: "det", name: "v1/scoring.py", file: "app/detection/v1/scoring.py",
      does: "Cho điểm từng ứng viên để chọn tứ giác đúng — phần quyết định chất lượng detect.",
      how: ["Mỗi cạnh lấy mẫu mỗi 3 px (bỏ 6% hai đầu). <b>Độ phủ</b> = tỉ lệ điểm có gradient ≥ ngưỡng trong ±3 px theo pháp tuyến.", "<b>Tương phản</b> = trung vị khoảng cách màu Lab giữa hai phía cạnh (cách 5 px), chia 22 rồi kẹp 1.", "Cạnh sát mép ảnh được giả định là mép tài liệu, cho điểm tín nhiệm 0.45.", "Gộp: 0.65 × trung bình + 0.35 × cạnh yếu nhất → một cạnh ăn theo vân gỗ không cứu được cả tứ giác.", "Nhân hệ số <b>đồng nhất màu</b> phía trong (phạt tới 40% nếu 4 cạnh thấy các màu khác nhau) và hệ số kích thước."],
      io: "Vào: 4 góc + ScoreContext (gradient, Lab). Ra: điểm 0..1 + chi tiết từng cạnh." },
    { id: "geometry", layer: "det", name: "v1/geometry.py + params.py", file: "app/detection/v1/",
      does: "Hình học thuần và toàn bộ hằng số của v1.",
      how: ["<code>order_clockwise</code>, <code>polygon_area</code>, <code>is_convex</code>, <code>angle_diff</code> (mod π).", "<code>is_convex</code> viết bằng vòng lặp thuần vì gọi hàng nghìn lần với 4 điểm — numpy chậm hơn ở cỡ này.", "<code>params.py</code> gom mọi ngưỡng có chú thích để chỉnh ở một chỗ."],
      io: "Hàm thuần, không phụ thuộc ảnh." },
    { id: "metrics", layer: "det", name: "detection/metrics.py", file: "app/detection/metrics.py",
      does: "Thước đo chất lượng: chỉ số Jaccard giữa tứ giác dự đoán và đáp án.",
      how: ["JI = diện tích giao / diện tích hợp.", "Tô cả hai tứ giác lên lưới 1000×1000 bằng <code>fillConvexPoly</code> rồi đếm điểm ảnh."],
      io: "Vào: 2 tứ giác (0..1). Ra: số từ 0 đến 1." },

    // --- HẠ TẦNG ---
    { id: "imaging", layer: "infra", name: "imaging.py", file: "app/imaging.py",
      does: "Hàm xử lý ảnh dùng chung, không phụ thuộc phiên bản detect.",
      how: ["<code>decode_bytes/decode_b64</code>: OpenCV tự xoay theo EXIF nên ảnh chụp bằng điện thoại không bị nghiêng.", "<code>order_corners</code>: sắp 4 điểm TL, TR, BR, BL bằng tổng và hiệu x/y.", "<code>warp</code>: <code>getPerspectiveTransform</code>; kích thước đích lấy từ cạnh dài hơn của mỗi cặp, tối đa 2400 px.", "<code>draw_overlay</code>: tô khung cam, 4 chấm xanh; độ dày tự co theo kích thước ảnh."],
      io: "Vào/ra: ảnh BGR (numpy)." },
    { id: "storage", layer: "infra", name: "storage.py", file: "app/storage.py",
      does: "Lưu và đọc kết quả của trang web vào thư mục <code>data/detections/&lt;id&gt;/</code>.",
      how: ["Id dạng <code>YYYYMMDD-HHMMSS-xxxx</code>, kiểm bằng regex → chặn truy cập file ngoài thư mục data.", "Giữ nguyên byte ảnh gốc nếu là jpg/png/webp; định dạng khác lưu lại JPEG chất lượng 95.", "Sinh thêm <code>annotated.jpg</code>, <code>thumb.jpg</code> (480 px), <code>warped.jpg</code> (nếu tìm thấy) và <code>result.json</code>.", "<code>list_all</code> bỏ phần <code>debug</code> nặng, mới nhất trước, bỏ qua thư mục dở dang."],
      io: "Vào: ảnh + kết quả. Ra: bản ghi (cũng là result.json)." },
    { id: "config", layer: "infra", name: "config.py + run.ps1", file: "app/config.py · server/run.ps1",
      does: "Cấu hình server và script khởi chạy.",
      how: ["<code>DATA_DIR</code> đổi bằng biến môi trường <code>SCAN_DATA_DIR</code>; <code>MAX_UPLOAD_BYTES</code> = 40 MB.", "<code>run.ps1</code>: kích hoạt môi trường cục bộ, tạo venv + cài thư viện lần đầu, in IP mạng LAN, chạy uvicorn."],
      io: "—" },

    // --- WEB ---
    { id: "webui", layer: "web", name: "Tab Kiểm tra detect", file: "web/static/index.html · app.js · style.css",
      does: "Công cụ cho admin/dev: upload ảnh, chạy detect, xem 4 góc và lưu lại để so sánh các phiên bản.",
      how: ["Không framework: hàm <code>h()</code> dựng DOM, <code>fetch</code> gọi <code>/api/*</code>.", "Lớp phủ khung (4 góc đánh số 1–4) và đường thẳng là SVG vẽ đè lên ảnh; kết quả điểm &lt; 0.6 vẽ nét đứt.", "Upload: chọn nhiều file, kéo-thả, dán Ctrl+V; trạng thái bận hiện ngay trong ô thả.", "Cột thông tin: nút tải ảnh gốc / ảnh có khung / ảnh phẳng / JSON và nút Xóa; thanh điểm từng cạnh (phủ × tương phản).", "Danh sách trái thu gọn/ngăn kéo; trạng thái thu gọn nhớ trong localStorage; chế độ tối theo hệ điều hành."],
      io: "Gọi: /api/detectors, /api/detections…" },
    { id: "webdocs", layer: "web", name: "Tab Document", file: "web/static/docs.html · docs.js · docs.css",
      does: "Chính trang bạn đang đọc: tài liệu dự án cho admin/dev, ưu tiên hình minh họa.",
      how: ["<code>docs.html</code> được tải lười khi mở tab lần đầu.", "Các hình (pipeline, máy tính điểm, sequence) dựng bằng JS/SVG từ dữ liệu, không dùng thư viện.", "Địa chỉ <code>#docs/&lt;mục&gt;</code> mở thẳng một mục."],
      io: "—" },

    // --- APP ---
    { id: "appscreens", layer: "app", name: "Màn hình app", file: "src/app/ (Expo Router)",
      does: "Phần người dùng cuối thấy: danh sách ảnh và camera chụp. Chưa có logic detect.",
      how: ["<code>index.tsx</code>: FlatList 2 cột, nút tròn (FAB) mở camera; mỗi ảnh có <code>accessibilityLabel</code>.", "<code>scan.tsx</code>: <code>CameraView</code> của expo-camera, <code>takePictureAsync({quality: 0.9})</code> → <code>addPhoto</code> → quay lại.", "<code>_layout.tsx</code>: Stack, bọc <code>PermissionGate</code> để xin quyền camera trước khi vào app."],
      io: "Dành cho người khiếm thị: nút lớn (MIN_TOUCH), nhãn truy cập (accessibilityLabel)." },
    { id: "photos", layer: "app", name: "photos.ts + theme.ts", file: "src/photos/photos.ts · src/theme.ts",
      does: "Kho ảnh tạm trong bộ nhớ và bảng màu/cỡ chữ dùng chung.",
      how: ["Kho ảnh dùng <code>useSyncExternalStore</code>: một mảng + tập listener, không cần thư viện state.", "Mất khi tắt app — lưu lâu dài nằm ở module tạm tắt <code>storage/</code>.", "<code>theme.ts</code>: màu, cỡ chữ, <code>MIN_TOUCH</code> (vùng chạm tối thiểu)."],
      io: "—" },
    { id: "appoff", layer: "app", status: "off", name: "src/_disabled/", file: "src/_disabled/**",
      does: "Các module đã viết nhưng tạm tắt để tập trung vào server.",
      how: ["Gồm camera WebView, vòng lấy khung, kết nối server, tính hướng dẫn, đọc giọng nói, lưu trữ, màn chi tiết.", "Không build/lint/typecheck; gắn lại bằng cách chuyển file về <code>src/</code>.", "Người dùng cuối hiện chỉ có camera và danh sách ảnh (xem mục \"App của người dùng\")."],
      io: "—" },

    // --- TEST ---
    { id: "tests", layer: "test", name: "server/tests/", file: "server/tests/*.py",
      does: "34 test cho server, chạy bằng pytest.",
      how: ["<code>scenes.py</code> tạo ảnh tổng hợp: nền gỗ, giấy có chữ và dòng kẻ, vòng gáy xoắn, dây cáp đè lên mép, nhiễu.", "<code>test_v1</code> kiểm thuật toán (kèm 1 test ảnh thật, tự bỏ qua nếu thiếu <code>document/detect/example.jpg</code>); <code>test_web</code> kiểm upload/lưu/xóa và chống truy cập ngoài data; <code>test_mobile</code> kiểm WebSocket và warp; <code>test_metrics</code> kiểm Jaccard."],
      io: "—" },
  ];

  const PIPE = [
    { t: "Ảnh gốc", d: "Ảnh bất kỳ cỡ được thu nhỏ về cạnh dài 640 px. Đo độ sắc (phương sai Laplacian) và độ lệch chuẩn xám: nếu ảnh quá phẳng (σ &lt; 8) trả ngay <code>lowContrast</code>.", ms: "ảnh phẳng: ~4 ms rồi dừng" },
    { t: "Làm mịn", d: "Closing hình thái 5×5 lặp 3 lần xóa chữ và hình bên trong trang, chỉ còn mặt giấy phẳng — các cạnh ngoài không bị ảnh hưởng.", ms: "debug.timingsMs.prep ≈ 6 ms" },
    { t: "Đoạn thẳng", d: "LSD tìm rất nhiều đoạn thẳng ngắn: dọc 4 mép giấy (bị ngắt do bị che) lẫn các đoạn nhiễu như vân bàn, mép đồ vật.", ms: "debug.timingsMs.lines ≈ 10 ms (gộp cả LSD và bước gộp)" },
    { t: "Gộp đường", d: "Các đoạn thẳng hàng (lệch ≤ 4°, cách ≤ 3 px) được gộp thành đường dài và khớp lại hướng, vị trí từ moment có trọng số độ dài. Đường ngắn (&lt; 7% cạnh dài) bị bỏ. Đường được kéo dài vô hạn để lấy giao điểm.", ms: "tính chung với bước 3 trong debug.timingsMs.lines" },
    { t: "Ứng viên", d: "Ghép hai cặp cạnh đối thành tứ giác, góc = giao điểm. Bên cạnh tứ giác đúng còn các tứ giác sai (ôm nhầm khối chữ, lấn ra mặt bàn). Giữ tối đa 30 theo độ phủ của đường lên chu vi.", ms: "debug.timingsMs.quads ≈ 25–45 ms (gồm cả bước chấm điểm)" },
    { t: "Chấm điểm", d: "Mỗi cạnh: độ phủ × tương phản trong/ngoài. Tứ giác đúng có cả 4 cạnh mạnh; tứ giác sai có ít nhất một cạnh yếu nên bị cạnh yếu nhất kéo điểm xuống.", ms: "tính chung với bước 5" },
    { t: "Kết quả", d: "Chọn tứ giác điểm cao nhất; độ tin cậy = điểm / 0.8. Trả 4 góc chuẩn hóa, bbox, chạm mép. Web nắn phẳng bằng phép biến đổi phối cảnh.", ms: "tổng ≈ 40–60 ms (đo trên máy dev, 2 ảnh thử)" },
  ];

  const PARAMS = [
    ["Ảnh làm việc", "WORK_SIDE", "640 px", "Cạnh dài sau khi thu nhỏ"],
    ["Ảnh làm việc", "LOW_CONTRAST_STD", "8.0", "σ xám dưới mức này → lowContrast"],
    ["Làm mịn", "CLOSE_KERNEL × ITERATIONS", "5 × 3", "Xóa chữ trong trang"],
    ["Gộp đường", "MERGE_ANGLE / MERGE_DIST", "0.07 rad / 3 px", "Điều kiện gộp đoạn thẳng"],
    ["Gộp đường", "MIN_LINE_COVER / MAX_LINES", "7% / 24", "Bỏ đường ngắn, giới hạn số đường"],
    ["Dựng tứ giác", "PARALLEL_TOL", "0.55 rad (~31°)", "Cho phép phối cảnh khi ghép cạnh đối"],
    ["Dựng tứ giác", "MIN_AREA_RATIO / CORNER_MARGIN", "4% / 5%", "Diện tích tối thiểu; góc được lệch ra ngoài ảnh"],
    ["Dựng tứ giác", "PRESCORE_KEEP", "30", "Số ứng viên giữ lại để chấm đầy đủ"],
    ["Chấm điểm", "CONTRAST_FULL", "22 (Lab)", "Tương phản coi là \"đủ\""],
    ["Chấm điểm", "BORDER_CREDIT", "0.45", "Điểm cho cạnh sát mép ảnh"],
    ["Ngưỡng", "GRABCUT_TRIGGER", "0.50", "Điểm tốt nhất dưới mức này → thử GrabCut"],
    ["Ngưỡng", "MIN_SCORE", "0.30", "Dưới mức này → không thấy tài liệu"],
  ];

  const API = [
    ["GET", "/", "web", "Trang kiểm tra (index.html)"],
    ["GET", "/api/detectors", "web", "Danh sách phiên bản detect"],
    ["POST", "/api/detections?version=&filename=", "web", "Upload byte ảnh, chạy detect, lưu, trả bản ghi"],
    ["GET", "/api/detections", "web", "Danh sách tóm tắt, mới nhất trước"],
    ["GET", "/api/detections/{id}", "web", "Bản ghi đầy đủ (có debug)"],
    ["GET", "/api/detections/{id}/files/{kind}", "web", "original · annotated · thumb · warped"],
    ["DELETE", "/api/detections/{id}", "web", "Xóa một lượt"],
    ["WS", "/ws", "mobile", "Khung nhỏ → 4 góc theo thời gian thực"],
    ["POST", "/warp", "mobile", "Ảnh lớn + 4 góc → ảnh nắn phẳng"],
    ["GET", "/health", "mobile", "Kiểm tra server, phiên bản OpenCV"],
  ];

  const SEQ = {
    web: {
      label: "Web: upload ảnh",
      actors: ["Trình duyệt", "routes/web", "Detector v1", "storage"],
      msgs: [
        [0, 1, "POST /api/detections  (byte ảnh)"],
        [1, 1, "imaging.decode_bytes  → ảnh BGR"],
        [1, 2, "detect(img)"],
        [2, 1, "result: 4 góc, confidence, debug", 1],
        [1, 3, "save(raw, img, result, timings)"],
        [3, 3, "ghi ảnh + result.json"],
        [3, 1, "bản ghi", 1],
        [1, 0, "200 JSON  (hiện ngay trên khung xem)", 1],
      ],
      cap: "Detect chạy trong threadpool nên server vẫn nhận được các request khác khi đang xử lý ảnh lớn.",
    },
    ws: {
      label: "App: khung thời gian thực",
      actors: ["App", "routes/mobile", "Detector v1"],
      msgs: [
        [0, 1, "WS /ws  (kết nối, giữ mở)"],
        [0, 1, "{seq, image(base64), version?}"],
        [1, 1, "decode_b64"],
        [1, 2, "detect(img)"],
        [2, 1, "kết quả + debug", 1],
        [1, 1, "bỏ trường debug"],
        [1, 0, "{seq, result, timings}", 1],
        [0, 1, "khung kế tiếp (lặp lại)"],
      ],
      cap: "Lỗi ở một khung (ảnh hỏng, phiên bản không có) chỉ trả {seq, error}; kết nối không bị đóng.",
    },
    warp: {
      label: "App: nắn phẳng ảnh chụp",
      actors: ["App", "routes/mobile", "imaging"],
      msgs: [
        [0, 1, "POST /warp  {image, corners[4]}"],
        [1, 2, "decode_b64 + warp(img, corners)"],
        [2, 2, "getPerspectiveTransform → warpPerspective"],
        [2, 1, "ảnh đã nắn phẳng", 1],
        [1, 0, "{image(base64), width, height}", 1],
      ],
      cap: "Khung phân tích gửi nhỏ qua WebSocket (app cũ: cạnh dài 480 px, JPEG 0.7); ảnh chụp cuối lấy độ phân giải cao (app cũ: 4096 px) nên đi riêng qua /warp.",
    },
  };

  const TESTS = [
    ["test_v1.py", 17, "tìm thấy giấy, sổ xoắn + dây + góc gấp, không có giấy, ảnh trơn, hợp đồng kết quả, chạm mép, đổi độ phân giải, registry, ảnh thật"],
    ["test_web.py", 9, "upload & đọc lại, không thấy giấy, thứ tự, xóa, lỗi đầu vào, chặn id lạ, giữ PNG"],
    ["test_mobile.py", 5, "health, WebSocket đúng định dạng, ảnh hỏng, phiên bản lạ, warp"],
    ["test_metrics.py", 3, "Jaccard: giống hệt = 1, không giao = 0, lệch ngang"],
  ];

  const APP_LIVE = [
    ["src/app/index.tsx", "Danh sách ảnh 2 cột + nút tròn mở camera"],
    ["src/app/scan.tsx", "Camera expo-camera, bấm để chụp"],
    ["components/PermissionGate", "Xin quyền camera trước khi vào app"],
    ["components/FabButton", "Nút tròn lớn, có nhãn truy cập"],
    ["photos/photos.ts", "Kho ảnh tạm trong bộ nhớ"],
  ];
  

  const JSON_FOUND = `{
  "found": true,
  "corners": [          // TL, TR, BR, BL (0..1)
    {"x": 0.12, "y": 0.09}, {"x": 0.91, "y": 0.13},
    {"x": 0.95, "y": 0.88}, {"x": 0.08, "y": 0.84}
  ],
  "bbox": {"x": 0.08, "y": 0.09, "w": 0.87, "h": 0.79},
  "areaRatio": 0.69,
  "touches": {"left": false, "right": false,
              "top": false, "bottom": false},
  "confidence": 0.93,   // 0..1 (web coi ≥ 0.6 là chắc chắn)
  "method": "lines",    // lines|color|bright|dark|grabcut
  "debug": {...}        // chỉ web; /ws bỏ đi
}`;
  const JSON_NOT = `{
  "found": false,
  "reason": "none",     // hoặc "lowContrast"
  "debug": {
    "workSize": [640, 480],
    "sharpness": 312.4,
    "bestScore": 0.21   // nếu có ứng viên nhưng quá yếu
  }
}

// "none"        : không tứ giác nào đạt 0.30
// "lowContrast" : ảnh gần như một màu (σ < 8),
//                 không đáng chạy tiếp`;

  // ============ DỰNG TRANG ============
  function initStats() {
    const stats = [
      ["1", "server FastAPI", "nơi xử lý ảnh duy nhất"],
      ["2", "tab trên web admin", "Kiểm tra detect · Document"],
      ["7", "bước pipeline detect", "ảnh → 4 góc"],
      ["34", "test tự động", "pytest"],
    ];
    $d("docStats").append(...stats.map(([n, l, s]) => el("div", "stat", `<b>${n}</b><span>${l}</span><i>${s}</i>`)));
  }

  function initModules() {
    const filter = $d("modFilter"), grid = $d("modGrid"), detail = $d("modDetail");
    let layer = "all", sel = null;
    const showDetail = (m) => {
      sel = m.id;
      detail.innerHTML = `
        <div class="md-head"><span class="lay ${m.layer}">${LAYERS[m.layer]}</span>${m.status === "off" ? '<span class="lay off">Tạm tắt</span>' : ""}<h3>${m.name}</h3></div>
        <p class="muted small mono">${m.file}</p>
        <div class="md-cols">
          <div><h4>Làm gì</h4><p>${m.does}</p><h4>Vào → Ra</h4><p>${m.io}</p></div>
          <div><h4>Thực hiện như thế nào</h4><ul>${m.how.map((x) => `<li>${x}</li>`).join("")}</ul></div>
        </div>`;
      grid.querySelectorAll(".mod").forEach((b) => b.classList.toggle("on", b.dataset.id === m.id));
    };
    const render = () => {
      grid.replaceChildren(...MODULES.filter((m) => layer === "all" || m.layer === layer).map((m) => {
        const b = el("button", `mod ${m.layer}${sel === m.id ? " on" : ""}`);
        b.type = "button"; b.dataset.id = m.id;
        b.innerHTML = `<span class="mod-bar"></span><b>${m.name}</b><span>${m.does.replace(/<[^>]+>/g, "")}</span>${m.status === "off" ? '<em>tạm tắt</em>' : ""}`;
        b.addEventListener("click", () => showDetail(m));
        return b;
      }));
    };
    const chip = (key, text) => {
      const b = el("button", "chip" + (key === layer ? " on" : ""), text);
      b.type = "button";
      b.addEventListener("click", () => { layer = key; [...filter.children].forEach((c) => c.classList.toggle("on", c === b)); render(); });
      return b;
    };
    filter.append(chip("all", "Tất cả"), ...Object.entries(LAYERS).map(([k, v]) => chip(k, v)));
    render();
    showDetail(MODULES.find((m) => m.id === "v1"));
  }

  // ---------- Pipeline minh họa ----------
  const C = { TL: [72, 52], TR: [332, 72], BR: [342, 252], BL: [58, 236] };
  const EDGES = [[C.TL, C.TR], [C.TR, C.BR], [C.BR, C.BL], [C.BL, C.TL]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const pts = (arr) => arr.map((p) => p.join(",")).join(" ");
  const line = (a, b, cls) => svg("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls });

  function pipeScene(step) {
    const g = svg("g");
    g.append(svg("rect", { width: 400, height: 300, class: "ps-bg" }));
    // vân bàn (nhiễu)
    const grain = [[10, 40, 60, 46], [20, 270, 130, 280], [350, 20, 392, 34], [360, 270, 392, 262], [5, 150, 30, 156], [372, 140, 396, 150]];
    const textLines = [];
    for (let i = 0; i < 7; i++) textLines.push([lerp(C.TL, C.BL, 0.16 + i * 0.11), lerp(C.TR, C.BR, 0.16 + i * 0.11)]);

    const page = svg("polygon", { points: pts([C.TL, C.TR, C.BR, C.BL]), class: "ps-page" });
    g.append(page);

    if (step <= 1) {
      grain.forEach(([a, b, c, d]) => g.append(line([a, b], [c, d], "ps-grain")));
      textLines.forEach(([a, b], i) => {
        const a2 = lerp(a, b, 0.12), b2 = lerp(a, b, i % 3 === 2 ? 0.55 : 0.86);
        g.append(line(a2, b2, "ps-text" + (step === 1 ? " fade" : "")));
      });
      g.append(svg("text", { x: 200, y: 292, class: "ps-cap", "text-anchor": "middle" }, step === 0 ? "ảnh thu về 640 px" : "closing 5×5 ×3: chữ biến mất, mép còn nguyên"));
      return g;
    }

    if (step === 2) {
      // đoạn LSD: dọc 4 mép (có khoảng hở) + nhiễu
      const iv = [[0.02, 0.2], [0.24, 0.43], [0.5, 0.6], [0.68, 0.97]];
      EDGES.forEach(([a, b]) => iv.forEach(([s, e]) => g.append(line(lerp(a, b, s), lerp(a, b, e), "ps-seg"))));
      grain.forEach(([a, b, c, d]) => g.append(line([a, b], [c, d], "ps-seg noise")));
      g.append(line([120, 130], [210, 134], "ps-seg noise"));
      g.append(svg("text", { x: 200, y: 292, class: "ps-cap", "text-anchor": "middle" }, "LSD: nhiều đoạn ngắn, bị ngắt, lẫn nhiễu"));
      return g;
    }

    const ext = (a, b, k) => [lerp(a, b, -k), lerp(a, b, 1 + k)];
    const mergedEdges = EDGES.map(([a, b]) => ext(a, b, 0.28));
    if (step === 3) {
      grain.forEach(([a, b, c, d]) => g.append(line([a, b], [c, d], "ps-seg noise faded")));
      mergedEdges.forEach(([a, b]) => g.append(line(a, b, "ps-merged")));
      g.append(line([-10, 280], [410, 262], "ps-merged alt"));
      g.append(svg("text", { x: 200, y: 292, class: "ps-cap", "text-anchor": "middle" }, "đoạn thẳng hàng → đường dài, kéo dài lấy giao điểm"));
      return g;
    }

    const decoyA = [[100, 80], [302, 92], [312, 216], [88, 206]];
    const decoyB = [[36, 28], [362, 48], [374, 284], [26, 266]];
    const best = [C.TL, C.TR, C.BR, C.BL];

    if (step === 4) {
      g.append(svg("polygon", { points: pts(decoyB), class: "ps-cand" }));
      g.append(svg("polygon", { points: pts(decoyA), class: "ps-cand" }));
      g.append(svg("polygon", { points: pts(best), class: "ps-cand main" }));
      [...best, ...decoyA, ...decoyB].forEach((p) => g.append(svg("circle", { cx: p[0], cy: p[1], r: 3.5, class: "ps-dot" })));
      g.append(svg("text", { x: 200, y: 292, class: "ps-cap", "text-anchor": "middle" }, "ứng viên: 1 đúng, vài sai (ôm chữ / lấn mặt bàn)"));
      return g;
    }

    const bar = (cx, cy, v, ok) => {
      const w = 34;
      return svg("g", {},
        svg("rect", { x: cx - w / 2, y: cy - 4, width: w, height: 8, rx: 4, class: "ps-barbg" }),
        svg("rect", { x: cx - w / 2, y: cy - 4, width: Math.max(3, w * v), height: 8, rx: 4, class: ok ? "ps-barok" : "ps-barbad" }));
    };
    if (step === 5) {
      g.append(svg("polygon", { points: pts(decoyB), class: "ps-cand" }));
      g.append(svg("polygon", { points: pts(decoyA), class: "ps-cand" }));
      g.append(svg("polygon", { points: pts(best), class: "ps-cand main ok" }));
      EDGES.forEach(([a, b], i) => { const m = lerp(a, b, 0.5); g.append(bar(m[0], m[1], [0.9, 0.84, 0.95, 0.88][i], true)); });
      g.append(bar(200, 110, 0.35, false)); g.append(bar(200, 205, 0.22, false));
      g.append(svg("text", { x: 200, y: 98, class: "ps-lbl bad", "text-anchor": "middle" }, "0.21"));
      g.append(svg("text", { x: 56, y: 22, class: "ps-lbl bad" }, "0.34"));
      g.append(svg("text", { x: 200, y: 36, class: "ps-lbl ok", "text-anchor": "middle" }, "0.86"));
      g.append(svg("text", { x: 200, y: 292, class: "ps-cap", "text-anchor": "middle" }, "mỗi cạnh: phủ × tương phản → cạnh yếu kéo điểm xuống"));
      return g;
    }

    // step 6: kết quả
    g.append(svg("polygon", { points: pts(best), class: "ps-result" }));
    best.forEach((p) => g.append(svg("circle", { cx: p[0], cy: p[1], r: 7, class: "ps-corner" })));
    ["TL", "TR", "BR", "BL"].forEach((n, i) => {
      const p = best[i];
      g.append(svg("text", { x: p[0] + (i === 1 || i === 2 ? -14 : 14), y: p[1] + (i < 2 ? -10 : 18), class: "ps-lbl", "text-anchor": i === 1 || i === 2 ? "end" : "start" }, n));
    });
    g.append(svg("rect", { x: 140, y: 138, width: 120, height: 26, rx: 13, class: "ps-chip" }));
    g.append(svg("text", { x: 200, y: 156, class: "ps-chiptxt", "text-anchor": "middle" }, "Tìm thấy · 100%"));
    g.append(svg("text", { x: 200, y: 292, class: "ps-cap", "text-anchor": "middle" }, "4 góc TL → TR → BR → BL, sẵn sàng nắn phẳng"));
    return g;
  }

  function initPipeline() {
    let i = 0;
    const stepsEl = $d("pipeSteps"), view = $d("pipeSvg"), text = $d("pipeText"), pos = $d("pipePos");
    const buttons = PIPE.map((p, k) => {
      const b = el("button", "pstep", `<i>${k + 1}</i><span>${p.t}</span>`);
      b.type = "button"; b.setAttribute("role", "tab");
      b.addEventListener("click", () => go(k));
      return b;
    });
    stepsEl.append(...buttons);
    function go(k) {
      i = Math.max(0, Math.min(PIPE.length - 1, k));
      buttons.forEach((b, j) => { b.classList.toggle("on", j === i); b.classList.toggle("done", j < i); b.setAttribute("aria-selected", j === i); });
      view.replaceChildren(pipeScene(i));
      text.innerHTML = `<h3>${i + 1}. ${PIPE[i].t}</h3><p>${PIPE[i].d}</p><p class="muted small mono">${PIPE[i].ms}</p>`;
      pos.textContent = `${i + 1} / ${PIPE.length}`;
      $d("pipePrev").disabled = i === 0; $d("pipeNext").disabled = i === PIPE.length - 1;
    }
    $d("pipePrev").addEventListener("click", () => go(i - 1));
    $d("pipeNext").addEventListener("click", () => go(i + 1));
    go(0);
  }

  // ---------- Máy tính điểm ----------
  function initCalc() {
    const root = $d("calc");
    const PRESETS = {
      "Tài liệu rõ": { cov: [95, 90, 96, 92], con: [95, 90, 98, 92], spread: 5 },
      "Nền trùng màu giấy": { cov: [85, 80, 88, 82], con: [30, 25, 35, 28], spread: 8 },
      "Một cạnh bị che": { cov: [92, 90, 15, 90], con: [95, 92, 90, 94], spread: 6 },
      "Quad vắt qua nhiều vật": { cov: [80, 70, 75, 85], con: [85, 80, 70, 80], spread: 55 },
    };
    const state = { cov: [95, 90, 96, 92], con: [95, 90, 98, 92], spread: 5 };
    const names = ["Trên", "Phải", "Dưới", "Trái"];
    const sliders = [];
    const mk = (label, key, idx, max = 100) => {
      const wrap = el("label", "sl");
      const out = el("b");
      const inp = el("input"); inp.type = "range"; inp.min = 0; inp.max = max; inp.step = 1;
      inp.addEventListener("input", () => { if (idx == null) state[key] = +inp.value; else state[key][idx] = +inp.value; update(); });
      wrap.append(el("span", null, label), inp, out);
      sliders.push({ inp, out, key, idx });
      return wrap;
    };
    const head = el("div", "calc-presets");
    Object.entries(PRESETS).forEach(([n, p]) => {
      const b = el("button", "chip", n); b.type = "button";
      b.addEventListener("click", () => { state.cov = [...p.cov]; state.con = [...p.con]; state.spread = p.spread; update(); });
      head.append(b);
    });
    const sides = el("div", "calc-sides");
    names.forEach((n, i) => {
      const col = el("div", "calc-side");
      col.append(el("h4", null, `Cạnh ${n.toLowerCase()}`), mk("Độ phủ cạnh", "cov", i), mk("Tương phản", "con", i), el("div", "side-out"));
      sides.append(col);
    });
    const spreadRow = el("div", "calc-spread"); spreadRow.append(mk("Lệch màu phía trong giữa các cạnh (Lab)", "spread", null, 60));
    const quad = svg("svg", { viewBox: "0 0 220 170", class: "calc-quad", role: "img", "aria-label": "Tứ giác với màu từng cạnh theo điểm" });
    const result = el("div", "calc-result");
    const layout = el("div", "calc-main");
    const left = el("div"); left.append(sides, spreadRow);
    const right = el("div", "calc-right"); right.append(quad, result);
    layout.append(left, right);
    root.append(head, layout);

    const Q = [[30, 24], [190, 34], [198, 140], [22, 132]];
    const qEdges = Q.map((p, i) => svg("line", { x1: p[0], y1: p[1], x2: Q[(i + 1) % 4][0], y2: Q[(i + 1) % 4][1], class: "cq-edge" }));
    quad.append(svg("polygon", { points: pts(Q), class: "cq-fill" }), ...qEdges);

    function update() {
      sliders.forEach(({ inp, out, key, idx }) => {
        const v = idx == null ? state[key] : state[key][idx];
        inp.value = v; out.textContent = idx == null ? `${v}` : `${v}%`;
      });
      const side = state.cov.map((c, i) => (c / 100) * (state.con[i] / 100));
      sides.querySelectorAll(".side-out").forEach((o, i) => { o.textContent = `side = ${side[i].toFixed(2)}`; });
      const mean = side.reduce((a, b) => a + b, 0) / 4, mn = Math.min(...side);
      const overall = 0.65 * mean + 0.35 * mn;
      const consistency = 1 - Math.min(0.4, Math.max(0, (state.spread - 15) / 40));
      const score = overall * consistency;
      const conf = Math.min(1, score / 0.8);
      side.forEach((s, i) => { qEdges[i].style.stroke = `hsl(${Math.round(s * 130)} 75% 45%)`; });
      let verdict, tone;
      if (score < 0.3) { verdict = "Không thấy tài liệu"; tone = "bad"; }
      else if (conf < 0.6) { verdict = "Chưa chắc chắn"; tone = "warn"; }
      else { verdict = "Tìm thấy tài liệu"; tone = "ok"; }
      result.innerHTML = `
        <div class="kv"><span>trung bình</span><b>${mean.toFixed(2)}</b></div>
        <div class="kv"><span>cạnh yếu nhất</span><b>${mn.toFixed(2)}</b></div>
        <div class="kv"><span>tổng (0.65·TB + 0.35·min)</span><b>${overall.toFixed(2)}</b></div>
        <div class="kv"><span>đồng nhất màu</span><b>×${consistency.toFixed(2)}</b></div>
        <div class="kv big"><span>điểm</span><b>${score.toFixed(2)}</b></div>
        <div class="kv"><span>độ tin cậy</span><b>${Math.round(conf * 100)}%</b></div>
        <div class="verdict ${tone}">${verdict}</div>
        ${score < 0.5 && score >= 0.3 ? '<p class="muted small">Điểm &lt; 0.5 → server sẽ thử thêm GrabCut.</p>' : ""}
        ${score < 0.3 ? '<p class="muted small">Điểm &lt; 0.5 → thử GrabCut; vẫn &lt; 0.30 thì báo không thấy.</p>' : ""}`;
    }
    update();
  }

  // ---------- Sơ đồ quyết định ----------
  function initFlow() {
    const s = $d("flowSvg");
    s.append(svg("defs", {}, svg("marker", { id: "ar2", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0L10 5L0 10z", class: "sv-fill-muted" }))));
    const box = (x, y, w, h, t1, t2, cls = "") => {
      s.append(svg("rect", { x, y, width: w, height: h, rx: 10, class: `sv-box ${cls}` }));
      s.append(svg("text", { x: x + w / 2, y: y + (t2 ? h / 2 - 3 : h / 2 + 5), class: "sv-t", "text-anchor": "middle" }, t1));
      if (t2) s.append(svg("text", { x: x + w / 2, y: y + h / 2 + 15, class: "sv-s", "text-anchor": "middle" }, t2));
    };
    const dia = (cx, cy, w, h, t1, t2) => {
      s.append(svg("polygon", { points: `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`, class: "sv-box c-api" }));
      s.append(svg("text", { x: cx, y: cy - 2, class: "sv-t", "text-anchor": "middle" }, t1));
      s.append(svg("text", { x: cx, y: cy + 15, class: "sv-s", "text-anchor": "middle" }, t2));
    };
    const arr = (d, cls = "") => s.append(svg("path", { d, class: `sv-arrow ${cls}`, "marker-end": "url(#ar2)" }));
    const lbl = (x, y, t, a = "middle") => s.append(svg("text", { x, y, class: "sv-l", "text-anchor": a }, t));

    box(10, 120, 106, 56, "Ảnh vào", "thu về 640 px", "c-app");
    dia(214, 148, 120, 92, "σ xám < 8 ?", "ảnh phẳng");
    box(154, 250, 120, 52, "lowContrast", "dừng ngay", "c-bad");
    box(316, 112, 180, 72, "LSD → đường → tứ giác", "+ vùng màu / sáng / tối", "c-det");
    dia(580, 148, 130, 96, "tốt nhất ≥ 0.5 ?", "");
    box(510, 250, 140, 52, "Thêm GrabCut", "224 px, 3 vòng", "c-det");
    dia(760, 148, 130, 96, "điểm ≥ 0.30 ?", "");
    box(710, 250, 100, 52, "Không thấy", "reason: none", "c-bad");
    box(710, 14, 100, 52, "Tìm thấy", "conf = điểm/0.8", "c-ok");

    arr("M116 148H154");
    arr("M214 194V250"); lbl(224, 226, "có", "start");
    arr("M274 148H316"); lbl(295, 138, "không");
    arr("M496 148H515");
    arr("M580 196V250"); lbl(590, 226, "chưa", "start");
    arr("M645 148H695"); lbl(670, 138, "đủ");
    s.append(svg("path", { d: "M650 276H672V150", class: "sv-arrow dash", fill: "none" }));
    arr("M760 196V250"); lbl(770, 226, "không", "start");
    arr("M760 102V66"); lbl(770, 88, "có", "start");
  }

  function initTables() {
    const pt = $d("paramTable");
    pt.innerHTML = "<thead><tr><th>Nhóm</th><th>Tham số</th><th>Giá trị</th><th>Ý nghĩa</th></tr></thead>";
    const tb = el("tbody"); PARAMS.forEach((r) => tb.append(el("tr", null, `<td>${r[0]}</td><td><code>${r[1]}</code></td><td class="mono">${r[2]}</td><td>${r[3]}</td>`)));
    pt.append(tb);
    const at = $d("apiTable");
    at.innerHTML = "<thead><tr><th>Phương thức</th><th>Đường dẫn</th><th>Nhóm</th><th>Công dụng</th></tr></thead>";
    const tb2 = el("tbody");
    API.forEach((r) => tb2.append(el("tr", null, `<td><span class="verb ${r[0].toLowerCase()}">${r[0]}</span></td><td><code>${r[1]}</code></td><td><span class="lay ${r[2] === "web" ? "web" : "app"}">${r[2] === "web" ? "web" : "app"}</span></td><td>${r[3]}</td>`)));
    at.append(tb2);
  }

  // ---------- Sequence diagram ----------
  function drawSeq(seq) {
    const n = seq.actors.length, colW = 190, W = n * colW, top = 44, rowH = 40;
    const H = top + seq.msgs.length * rowH + 30;
    const x = (i) => colW * i + colW / 2;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: W, class: "sv seq", role: "img", "aria-label": seq.label });
    s.append(svg("defs", {}, svg("marker", { id: "ar3", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0L10 5L0 10z", class: "sv-fill-muted" }))));
    seq.actors.forEach((a, i) => {
      s.append(svg("line", { x1: x(i), y1: 34, x2: x(i), y2: H - 10, class: "seq-life" }));
      s.append(svg("rect", { x: x(i) - 70, y: 4, width: 140, height: 30, rx: 8, class: "sv-box c-api" }));
      s.append(svg("text", { x: x(i), y: 24, class: "sv-t", "text-anchor": "middle" }, a));
    });
    seq.msgs.forEach(([f, t, text, ret], k) => {
      const y = top + 22 + k * rowH;
      if (f === t) {
        const x0 = x(f);
        s.append(svg("rect", { x: x0 - 4, y: y - 14, width: 8, height: 24, rx: 3, class: "seq-act" }));
        const left = f === n - 1;
        s.append(svg("path", { d: left ? `M${x0 - 4} ${y - 8}h-26v14h26` : `M${x0 + 4} ${y - 8}h26v14h-26`, class: "sv-arrow", fill: "none", "marker-end": "url(#ar3)" }));
        s.append(svg("text", { x: left ? x0 - 38 : x0 + 38, y: y + 3, class: "sv-l", "text-anchor": left ? "end" : "start" }, text));
        return;
      }
      s.append(svg("line", { x1: x(f), y1: y, x2: x(t) + (t > f ? -4 : 4), y2: y, class: `sv-arrow${ret ? " dash" : ""}`, "marker-end": "url(#ar3)" }));
      s.append(svg("text", { x: (x(f) + x(t)) / 2, y: y - 7, class: "sv-l", "text-anchor": "middle" }, text));
    });
    return s;
  }
  function initSeq() {
    const tabs = $d("seqTabs"), mount = $d("seqMount"), cap = $d("seqCap");
    const keys = Object.keys(SEQ);
    const show = (k) => {
      [...tabs.children].forEach((c) => c.classList.toggle("on", c.dataset.k === k));
      mount.replaceChildren(drawSeq(SEQ[k])); cap.textContent = SEQ[k].cap;
    };
    keys.forEach((k) => { const b = el("button", "chip", SEQ[k].label); b.type = "button"; b.dataset.k = k; b.addEventListener("click", () => show(k)); tabs.append(b); });
    show("web");
  }

  function initTree() {
    const rows = [
      [0, "data/detections/", "dir", ""],
      [1, "20261030-141502-a3f9/", "dir", "một lượt detect (id = ngày-giờ-4 ký tự ngẫu nhiên)"],
      [2, "original.jpg", "img", "ảnh upload, giữ nguyên byte (jpg/png/webp)"],
      [2, "annotated.jpg", "img", "ảnh gốc vẽ khung cam + 4 góc xanh"],
      [2, "thumb.jpg", "img", "ảnh nhỏ 480 px cho danh sách"],
      [2, "warped.jpg", "img", "tài liệu đã nắn phẳng — chỉ có khi tìm thấy"],
      [2, "result.json", "json", "toàn bộ bản ghi: result, timingsMs, imageSize, files"],
    ];
    $d("tree").append(...rows.map(([lv, name, kind, note]) => el("div", `tr lv${lv}`, `<span class="ico ${kind}"></span><code>${name}</code>${note ? `<span class="muted small">${note}</span>` : ""}`)));
    $d("jsonFound").textContent = JSON_FOUND;
    $d("jsonNot").textContent = JSON_NOT;
  }

  function initApp() {
    $d("appLive").innerHTML = APP_LIVE.map(([a, b]) => `<div class="fv"><code>${a}</code><span>${b}</span></div>`).join("");
    const s = $d("appFlow");
    s.append(svg("defs", {}, svg("marker", { id: "ar4", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0L10 5L0 10z", class: "sv-fill-muted" }))));
    const nodes = [["Xin quyền camera", "PermissionGate"], ["Danh sách ảnh", "index.tsx"], ["Camera", "scan.tsx"], ["Ảnh mới", "addPhoto → danh sách"]];
    nodes.forEach(([t, sub], i) => {
      const y0 = 6 + i * 40;
      s.append(svg("rect", { x: 10, y: y0, width: 200, height: 32, rx: 8, class: "sv-box c-app" }));
      s.append(svg("text", { x: 22, y: y0 + 14, class: "sv-t" }, t));
      s.append(svg("text", { x: 22, y: y0 + 27, class: "sv-s" }, sub));
      if (i < nodes.length - 1) s.append(svg("path", { d: `M110 ${y0 + 32}v8`, class: "sv-arrow", "marker-end": "url(#ar4)" }));
    });
    s.append(svg("path", { d: "M210 86H250V166H210", class: "sv-arrow dash", fill: "none" }));
    s.append(svg("text", { x: 258, y: 120, class: "sv-l" }, "nút tròn"));
    s.append(svg("text", { x: 258, y: 134, class: "sv-l" }, "mở camera"));
  }

  function initRoad() {
    const have = [
      ["WS /ws biết người gọi", "<code>ws.client</code> cho host:port của thiết bị; đã log kết nối/ngắt kết nối và thời gian từng khung (<code>seq</code>, detect ms)."],
      ["POST /warp đã log", "kích thước ảnh vào/ra và thời gian xử lý."],
      ["Lịch sử detect của web", "<code>storage</code> + <code>GET /api/detections</code>: nơi để thêm lịch sử các yêu cầu từ app."],
      ["GET /health", "đã báo phiên bản OpenCV và detector có sẵn."],
    ];
    const todo = [
      ["Danh sách thiết bị đang kết nối", "cần bộ đếm trong bộ nhớ: kết nối, ngắt, lần cuối thấy, số khung đã gửi."],
      ["Ghi lại các yêu cầu từ app", "hiện chỉ in ra terminal, chưa lưu. Cần phân loại: khung ws / warp / health; kết quả found; độ trễ."],
      ["Tab \"Thiết bị\" và \"Yêu cầu\"", "API <code>/api/admin/…</code> + tab mới trên thanh tab; cấu trúc tab hiện tại đã sẵn sàng."],
      ["Nhận ảnh từ app vào lịch sử", "app hiện chưa gửi gì lên server."],
      ["Xác thực admin", "hiện web và API mở cho mọi máy trong mạng — cần khóa trước khi đưa lên ngoài LAN."],
    ];
    const col = (title, rows, cls) => `<div class="card pad-l road-col ${cls}"><h3>${title}</h3>${rows.map(([a, b]) => `<div class="fv"><b>${a}</b><span>${b}</span></div>`).join("")}</div>`;
    $d("road").innerHTML = col("Đã có để gắn vào", have, "have") + col("Còn thiếu (chưa làm)", todo, "todo");
  }

  function initTests() {
    const max = Math.max(...TESTS.map((t) => t[1]));
    $d("testBars").append(...TESTS.map(([f, n, d]) => el("div", "tb", `<code>${f}</code><div class="tb-bar"><i style="width:${(n / max) * 100}%"></i><b>${n}</b></div><span class="muted small">${d}</span>`)));
  }

  // ---------- Mục lục + cuộn ----------
  function initToc() {
    const toc = $d("docToc");
    const secs = [...document.querySelectorAll(".doc-sec")];
    let lastGroup = null;
    secs.forEach((s) => {
      if (s.dataset.group !== lastGroup) { lastGroup = s.dataset.group; toc.append(el("div", "toc-group", lastGroup)); }
      const a = el("a", null, s.dataset.title); a.href = `#docs/${s.id}`; a.dataset.id = s.id;
      a.addEventListener("click", (e) => { e.preventDefault(); goSection(s.id); });
      toc.append(a);
    });
    const scroller = () => (window.matchMedia("(max-width: 960px)").matches ? window : $d("docMain"));
    let ticking = false;
    const spy = () => {
      ticking = false;
      const y = (scroller() === window ? 0 : $d("docMain").getBoundingClientRect().top) + 140;
      let cur = secs[0];
      for (const s of secs) if (s.getBoundingClientRect().top <= y) cur = s;
      toc.querySelectorAll("a").forEach((a) => { const on = a.dataset.id === cur.id; a.classList.toggle("on", on); if (on && window.matchMedia("(max-width: 960px)").matches) a.scrollIntoView({ block: "nearest", inline: "center" }); });
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(spy); } };
    $d("docMain").addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    spy();
  }

  function goSection(id, smooth = true) {
    const s = document.getElementById(id);
    if (!s) return;
    s.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    history.replaceState(null, "", `#docs/${id}`);
  }

  // ============ CHUYỂN TAB ============
  let loaded = null;
  async function loadDocs() {
    if (!loaded) {
      loaded = fetch("/static/docs.html").then((r) => { if (!r.ok) throw new Error(`Lỗi ${r.status}`); return r.text(); }).then((html) => {
        $d("docs").innerHTML = html;
        initStats(); initModules(); initPipeline(); initCalc(); initFlow(); initTables(); initSeq(); initTree(); initApp(); initTests(); initRoad(); initToc();
      });
      loaded.catch(() => { loaded = null; $d("docs").innerHTML = '<p class="pad muted">Không tải được tài liệu. Thử tải lại trang.</p>'; });
    }
    return loaded;
  }

  async function setMode(mode, { section, push = true } = {}) {
    const docs = mode === "docs";
    document.body.classList.toggle("mode-docs", docs);
    $d("docs").hidden = !docs;
    document.querySelectorAll(".main-tab").forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    if (docs) {
      await loadDocs().catch(() => {});
      if (push) history.replaceState(null, "", section ? `#docs/${section}` : "#docs");
      if (section) goSection(section, false);
    } else if (push) {
      const cur = typeof state !== "undefined" ? state.current : null;
      history.replaceState(null, "", cur ? `#${cur.id}` : location.pathname);
    }
  }

  document.querySelectorAll(".main-tab").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  window.addEventListener("hashchange", () => {
    const m = location.hash.match(/^#docs(?:\/(.+))?$/);
    if (m) setMode("docs", { section: m[1], push: false });
  });
  const m = location.hash.match(/^#docs(?:\/(.+))?$/);
  if (m) setMode("docs", { section: m[1], push: false });
})();
