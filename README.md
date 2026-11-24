# Scan Trợ Giúp

App giúp người khiếm thị quét tài liệu: hướng dẫn cho tới khi tài liệu nằm đúng khung, chụp lại thành ảnh phẳng, rõ, rồi nhận dạng chữ và đọc nội dung thành tiếng từng câu — tất cả chạy trên điện thoại, không cần mạng. Chỉ đăng ký / đăng nhập là cần mạng (thư mục `Server/`); lịch sử quét lưu trên máy.

## Cấu trúc

```
Scan/
├── App/    app điện thoại (Expo): src/, assets/, package.json
├── Server/ server đăng ký / đăng nhập (Node thuần + SQLite) — chỉ lo tài khoản, xem Server/README.md
└── Core/   công nghệ lõi: nhận diện tài liệu (tìm 4 góc)
    ├── detect/     các phiên bản detect: v1 (Python/OpenCV), v2 (gọi thư viện C++)
    ├── native/     thư viện C++ docdetect (v2, dùng chung cho mobile)
    ├── dataset/    bộ dữ liệu đã chuẩn hóa (<tên>/images + labels.json); dữ liệu gốc ở dataset/_raw
    ├── results/    kết quả đánh giá: results/<phiên bản>@<letterbox>/<bộ>.json
    ├── tools/      script: chuẩn hóa dataset, đánh giá, benchmark
    ├── web/        trang web visualize kết quả
    ├── uploads/    ảnh thử trên trang web
    └── docs/       tài liệu nghiên cứu
```

`activate.ps1` (ở gốc) bật môi trường cô lập dùng chung cho cả hai: Node, cache npm/pip, thư mục tạm đều nằm trong dự án.

## Chạy

```powershell
.\Core\run.ps1                              # web visualize: http://localhost:8000/
. .\activate.ps1; cd App; npx expo start    # app, quét QR bằng Expo Go
.\Server\run.ps1                            # server đăng nhập / đăng ký (cổng 4000), cần cho lần đăng nhập đầu
```

### Web visualize

Mỗi màn hình có URL riêng, mọi lựa chọn nằm trong URL: tải lại, mở tab mới để so sánh, hay gửi link đều ra đúng màn hình đó.

| URL | Nội dung |
|---|---|
| `/` | Bảng chỉ số mọi phiên bản × bộ dữ liệu |
| `/d/<bộ>?run=v2@256&vs=v1@256` | Một bộ dữ liệu: chỉ số (so với phiên bản khác), phân bố IoU, theo nhóm, lưới ảnh có lọc |
| `/d/<bộ>/i/<ảnh>` | Một ảnh: đáp án + dự đoán mọi phiên bản, chồng lớp hoặc cạnh nhau, detect lại. Phím ← → Esc |
| `/try` | Thử ảnh bất kỳ (dán, kéo thả) |
| `/eval` | Chạy đánh giá, theo dõi tiến độ |
| `/algorithms?ds=<bộ>&id=<ảnh>` | Thuật toán v3 chạy từng bước trên một ảnh thật: ảnh trung gian, ứng viên, điểm, tinh chỉnh, nắn phẳng; v2 → v3, tham số, kết quả đo |
| `/video?v=<nền>/<tên>` | Luồng xử lý video của app: kiến trúc, phát lại video SmartDoc thật với `App/web/tracker.js`, từng quy tắc theo dõi, gợi ý, chụp |

### Dòng lệnh (từ `Core/`)

```powershell
.venv\Scripts\python.exe -m tools.evaluate --version v2 --size 256        # đánh giá, ghi vào results/
.venv\Scripts\python.exe -m tools.bench_detect                            # so tốc độ v1/v2
.venv\Scripts\python.exe -m tools.prepare_dataset                         # dataset/_raw -> dataset/
.\native\docdetect\build.ps1                                              # build lại thư viện C++ (v2)
```

Kiểm tra app: `cd App; npm run typecheck; npm run lint; npm test`.

### App: quét bằng docdetect_v3

Trang chủ → "Quét tài liệu" → camera + khung tài liệu theo thời gian thực → bấm chụp → ảnh đã nắn phẳng.
Để chạy được trên Expo Go, camera và detect nằm trong WebView: `Core/native/docdetect_v3` (giữ nguyên mã nguồn)
được biên dịch cùng OpenCV core/imgproc sang WebAssembly, chạy trong Web Worker.

```
App/
├── native/scan_api.cpp      cầu nối wasm: scan_detect (gọi dd3_detect), scan_warp (warpPerspective)
├── native/build-wasm.ps1    build OpenCV wasm (lần đầu) + docdetect -> native/build/docdetect.js
├── web/                     trang trong WebView: page.js (camera, vòng detect, vẽ, chụp), tracker.js, worker.js
├── scripts/build-web.mjs    gói web/ + engine -> src/scanner/page.generated.ts (+ src/layout/layout.generated.ts)
└── src/app/                 index (trang chủ), scan (màn quét), result (ảnh nắn phẳng + bố cục)
```

```powershell
. .\activate.ps1
.\App\native\build-wasm.ps1     # cần Emscripten SDK ở .tools/emsdk
cd App; npm run build:web       # sau khi sửa web/ (không cần emsdk)
```

Chưa build engine thì app vẫn mở camera và chụp được ảnh gốc, kèm thông báo thiếu bộ nhận diện.

Trên màn quét có hai tùy chọn để thử (lưu trên máy): **Khung 256 / 640** — cạnh dài khung gửi detect (docdetect_v3 vẫn xử lý ở 256 px; 640 thì C++ tự thu nhỏ) — và **Tracker / Không** — lọc khung qua `web/tracker.js` hoặc vẽ thẳng kết quả detect. Detect không giới hạn nhịp: mỗi khung camera mới, khi Worker rảnh. Dòng số đo ở góc trên hiện số lần detect/giây và thời gian detect.

Đối chiếu bản wasm với DLL native (cùng điểm ảnh, ảnh thật từ `Core/dataset`):

```powershell
Core\.venv\Scripts\python.exe App\native\verify\dump_native.py --per-set 40   # kết quả native -> .tmp/wasm-verify
node App\native\verify\compare.mjs                                            # chạy wasm, so từng góc
```

### App: đọc nội dung tài liệu (OCR + đọc từng câu)

Sau khi chụp, app tự chạy cả dây chuyền trên máy (không mạng, không server) rồi đọc nội dung thành tiếng:

```
chụp (khung video 4K) -> tìm 4 góc + nắn phẳng (docdetect_v3 wasm)          [màn camera]
  -> 1. hướng trang + bố cục   PP-LCNet doc_ori + PP-DocLayout-S (onnxruntime-web)   ~0,2-0,5 s
  -> 2. xoay thẳng nếu trang bị xoay 90/180/270° (expo-image-manipulator)
  -> 3. nhận dạng chữ          khử bóng + đổi cỡ (JS) -> Tesseract 5 LSTM tiếng Việt (WebAssembly)   ~1 s
  -> 4. ghép đoạn + tách câu   (TypeScript thuần)
  -> màn kết quả: nội dung theo đoạn, câu đang đọc tô sáng trên ảnh; đọc bằng giọng của máy (expo-speech)
```

**Màn kết quả**: thanh cố định ở đáy có ba nút to **Câu trước / Đọc lại / Câu sau**; có nội dung là đọc luôn câu đầu.
Chạm một câu trong danh sách để đọc câu đó; chạm ô "câu hiện tại" để dừng. Tùy chọn: đọc từng câu / liên tục, tốc độ,
ảnh "Rõ chữ" / gốc, hiện khung bố cục. Cuối trang có thời gian từng bước (mục tiêu ≤ 5 s từ lúc chụp xong).

**Vì sao chọn như vậy** (đo trên máy tính, xem lệnh bên dưới):

- *OCR = Tesseract (vie, tessdata_fast)*: PaddleOCR không có model nhận dạng tiếng Việt — bảng ký tự của
  `latin_PP-OCRv5_mobile_rec` thiếu gần hết chữ có dấu (ạ, ấ, ề, ợ, ữ...). Tesseract có model riêng cho tiếng Việt, tự
  phân tích bố cục (khối -> đoạn -> dòng, đọc đúng thứ tự cột), nhẹ (wasm 2,9 MB + dữ liệu 0,5 MB) và chạy bằng wasm
  thường nên dùng được trong Expo Go trên cả iOS lẫn Android.
- *Khử bóng trước khi OCR là bắt buộc*: Tesseract tách ngưỡng toàn cục, ảnh chụp có bóng đổ làm mất cả mảng chữ. Trên
  bộ trang thử: sai ký tự 35% (không tiền xử lý) -> 1,4% (có).
- *Độ phân giải quyết định độ chính xác*, nên camera mặc định là 4K (ảnh chụp lấy từ khung video):

  | Bề rộng trang giấy | ứng với camera | Sai ký tự (CER) | Sai từ (WER) |
  |---|---|---|---|
  | 700 px | 1080p | 0,3 - 10 % | 1 - 17 % |
  | 1000 px | | 0 - 0,8 % | 0 - 3,5 % |
  | 1350 px | 4K | 0 - 0,5 % | 0 - 2,2 % |
  | 1800 px | 4K, chụp gần | 0 - 0,6 % | 0 - 2,6 % |

  (3 trang tổng hợp: thông báo, hướng dẫn dùng thuốc, bài báo 2 cột; có bóng đổ, lệch 0,6°, mờ nhẹ, JPEG. Chưa đo trên
  ảnh chụp thật có đáp án.)
- *Bố cục chỉ còn PP-DocLayout-S* và chỉ để hiển thị khung (tùy chọn): thứ tự đọc lấy từ Tesseract. PP-DocLayout-L /
  plus-L (RT-DETR) đã bỏ khỏi app: trên iPhone (iOS 18, WKWebView + onnxruntime-web) bước suy luận không bao giờ xong
  (> 120 s) với cả bản uint8 lẫn fp32, trong khi S chỉ 0,13 s; WebView iOS 18 không có WebGPU. (Nhiều khả năng L "treo" là
  do WebView bị iOS cho ngủ như ghi chú bên dưới chứ không phải do model; chưa thử lại L sau khi sửa.)
- *Tách câu* (`src/reading/compose.ts`): dấu `. ! ? …` kết câu trừ khi là viết tắt (TP., ThS., PGS., v.v.), tên viết
  tắt (Nguyễn V. An), đầu mục (1., a., IV.), số thập phân / ngày tháng / số điện thoại, hoặc chữ sau viết thường; tiêu
  đề không có dấu kết câu là một câu; dòng cuối ngắn của đoạn bị Tesseract tách rời được nối lại; câu dài hơn 260 ký tự
  chia ở dấu `; : ,` gần giữa.

```
App/
├── assets/ocr/                         vie.traineddata (tessdata_fast, Apache-2.0) + tesseract-core-simd-lstm.wasm
├── assets/layout/                      pp_lcnet_doc_ori.onnx, pp_doclayout_s.onnx (+ onnxruntime wasm)
├── web/ocr-prep.js                     tiền xử lý OCR: xám hóa, phóng to chữ nhỏ / thu ảnh quá lớn, khử bóng nền
├── web/ocr-parse.js                    TSV của Tesseract -> dòng chữ có tọa độ + độ tin cậy
├── web/ocr-worker.js, ocr-page.js      Worker chạy Tesseract; trang ẩn (file://) đọc wasm / dữ liệu / ảnh từ file
├── web/layout.js, layout-worker.js,    hướng trang + PP-DocLayout (tiền / hậu xử lý như PaddleX), onnxruntime-web
│   layout-page.js
├── src/engine/enginePage.ts            chép asset vào cache + ghi trang cho một engine WebView ẩn
├── src/ocr/OcrEngine.tsx               WebView ẩn nhận dạng chữ: recognizeText(uri)
├── src/layout/LayoutEngine.tsx         WebView ẩn hướng trang + bố cục: analyzeLayout(uri)
├── src/layout/status.ts                trạng thái nạp từng phần (trang chủ hiển thị)
├── src/reading/runAnalysis.ts          dây chuyền 1 -> 4 cho bản quét hiện tại, cập nhật trạng thái cho màn kết quả
├── src/reading/compose.ts              lọc rác OCR, ghép đoạn, tách câu
├── src/reading/useReader.ts            điều khiển đọc từng câu (expo-speech): trước / đọc lại / sau, liên tục, tốc độ
├── src/components/ReaderBar.tsx        ba nút đọc
└── src/app/result.tsx                  màn kết quả
```

Hai engine (bố cục, OCR) là WebView ẩn mount ở `_layout.tsx`, nạp sẵn khi mở app; trang + asset ghi vào cache và mở bằng
`file://`, phần nặng chạy trong Web Worker, qua cầu nối chỉ có message nhỏ. Hai WebView này phải luôn nằm trong cửa sổ:
iOS cho tiến trình của WKWebView không thuộc cửa sổ nào ngủ sau một khoảnh khắc, nên việc dài vài giây bị đóng băng giữa
chừng (triệu chứng: bước nhận dạng chữ / suy luận model lớn không bao giờ xong, việc ngắn vẫn chạy). Vì vậy màn quét và
màn kết quả là màn kiểu thường (card), KHÔNG phải `fullScreenModal` — modal toàn màn hình gỡ gốc app khỏi cửa sổ. Mỗi
yêu cầu, trang ghi `visible` / `hidden` ra log (`[ocr] trang …`, `[layout] trang …`) để kiểm tra trên máy thật. `useSharedProcessPool={false}` để engine
không kéo chết WebView camera. Wasm của onnxruntime (14 MB) và Tesseract (2,9 MB) chép từ `node_modules` khi
`npm install` / `npm run build:web` (không commit).

Kiểm tra trên máy tính:

```powershell
# Từ Core/ (môi trường .tools/paddle-venv có Pillow + opencv): sinh bộ trang tiếng Việt có đáp án vào .tmp/ocr-testset
..\.tools\paddle-venv\Scripts\python.exe -m tools.make_ocr_testset
# Từ App/: chạy đúng pipeline OCR của app (ocr-prep.js + Tesseract wasm + ocr-parse.js), in CER / WER / thời gian
npm run check:ocr -- ..\.tmp\ocr-testset\thongbao_1350.jpg [--show] [--raw] [--json]
npm test            # tách câu (kể cả trên kết quả OCR thật trong src/__tests__/fixtures), tiền xử lý, bố cục
# Model: S (checkpoint Paddle -> ONNX, so Paddle gốc) và doc_ori; thêm --l để tạo PP-DocLayout-L cho máy tính
..\.tools\paddle-venv\Scripts\python.exe -m tools.export_layout_onnx ảnh.jpg --paddlex-ref
..\.tools\paddle-venv\Scripts\python.exe -m tools.export_layout_extra [--l ảnh.jpg]
npm run check:layout -- ảnh.jpg
```

Chưa làm: bản `AndroidApp/` (APK, onnxruntime native) chưa được cập nhật theo dây chuyền mới (OCR, tài khoản, lịch sử) —
`LayoutEngine` / `build-web` / danh sách đồng bộ riêng của nó cần sửa theo rồi build lại.

### App: tài khoản, ba mục chính, lịch sử

Mở app → chưa đăng nhập thì chỉ thấy **Đăng nhập / Đăng ký** (cần mạng, gọi `Server/`); đăng nhập rồi thì vào ba mục ở
thanh dưới: **Trang chủ** (nút quét, "Đọc tiếp" tài liệu gần nhất), **Lịch sử**, **Cài đặt**.

- **Tài khoản**: token nằm trong kho bảo mật của máy (`expo-secure-store`), hồ sơ lưu ở AsyncStorage. Đã đăng nhập thì
  dùng app không cần mạng: lúc mở app chỉ hỏi lại server ở nền, mất mạng thì giữ nguyên, server báo token hết hiệu lực
  mới đăng xuất. Cài đặt có: sửa tên / email (đổi email cần mật khẩu), đổi mật khẩu, đăng xuất, xóa tài khoản.
- **Địa chỉ máy chủ**: mặc định là máy tính đang chạy Expo, cổng 4000 (lấy từ `hostUri` của Expo Go); đổi được ở mục
  "Máy chủ" trên màn đăng nhập / Cài đặt, hoặc bằng `EXPO_PUBLIC_API_URL`.
- **Lịch sử** — chỉ lưu trên điện thoại, mỗi tài khoản một thư mục:
  `<thư mục tài liệu của app>/history/<id người dùng>/index.json` + `<id mục>/original.jpg, enhanced.jpg, doc.json`.
  Mỗi lần quét xong (có chữ) tự lưu một mục; tối đa 100 mục, quá thì bỏ mục cũ nhất. Mỗi mục nhớ **câu đang đọc dở**
  (ghi lại mỗi khi chuyển câu). Chạm một mục → màn kết quả y như lúc vừa quét (không nhận dạng lại) và đọc tiếp từ câu
  đó. Nhấn giữ hoặc bấm "Xóa" để xóa.

```
App/
├── src/app/_layout.tsx                 gốc: 2 engine WebView + điều hướng; chia màn theo trạng thái đăng nhập
├── src/app/login.tsx, register.tsx     đăng nhập / đăng ký
├── src/app/(tabs)/                     index (Trang chủ), history (Lịch sử), settings (Cài đặt) + thanh dưới
├── src/app/profile.tsx, password.tsx   sửa thông tin / xóa tài khoản, đổi mật khẩu
├── src/app/scan.tsx, result.tsx        màn quét, màn kết quả (dùng cho cả bản vừa quét lẫn mục lịch sử)
├── src/auth/api.ts, url.ts             gọi server, địa chỉ server, lỗi có thông báo tiếng Việt
├── src/auth/session.ts                 phiên đăng nhập (khôi phục, đăng nhập, đăng xuất, sửa hồ sơ...)
├── src/auth/AuthScreen.tsx             khung màn đăng nhập / đăng ký + mục "Máy chủ"
├── src/history/store.ts                lưu / đọc / xóa lịch sử trên máy, ghi câu đang đọc
├── src/history/open.ts                 mở một mục lịch sử lên màn kết quả
├── src/history/summary.ts              tiêu đề mục, ngày giờ, tiến độ đọc
└── src/components/                     Button, TextField, TabIcon, ReaderBar...
```

Chạy thử cả hai (hai cửa sổ PowerShell, từ thư mục gốc):

```powershell
.\Server\run.ps1                                  # server đăng nhập, cổng 4000
. .\activate.ps1; cd App; npx expo start -c       # app, quét QR bằng Expo Go (điện thoại cùng Wi-Fi với máy tính)
```

### Detect v3 (C++)

`Core/native/docdetect_v3` được clone từ v2, có thư viện và tiền tố API `dd3_` riêng.
Thêm ứng viên contour Canny, kiểm chứng hình dạng vùng, ưu tiên biên ngoài trang và
tinh chỉnh bốn cạnh bằng gradient + khớp đường Huber. Python chỉ làm adapter.

```powershell
# Từ thư mục gốc; dùng OpenCV tĩnh đã build cho v2:
.\Core\native\docdetect_v3\build.ps1

# Từ Core/:
.venv\Scripts\python.exe -m tools.evaluate --version v3 --size 256
.venv\Scripts\python.exe -m tools.compare_versions --phase validation --limit 600 --output reports/v3-validation.json
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe -m tools.check_mirror --per-set 60   # bản soi minh họa (detect/v3/mirror.py) khớp native?
```

Ảnh minh họa từng bước trên `/algorithms` lấy từ `detect/v3/mirror.py` — bản Python viết lại đúng các bước C++ để giữ ảnh trung gian; bốn góc và ảnh nắn vẫn do thư viện native trả. Sửa C++ thì sửa mirror theo và chạy lại `check_mirror`.

Trang `/video` cần video gốc SmartDoc ở `Core/dataset/videos/` (trích từ `dataset/_raw/testDataset.tar.gz`, ví dụ `tar xzf ... --strip-components=1 testDataset/background01/magazine004.avi testDataset/background01/magazine004.gt.xml`). Server chỉ tách khung và nhãn (lưu ở `Core/.cache/video/`). Detect chạy trong trình duyệt bằng engine WASM của app (`App/native/build/docdetect.js` + `App/web/worker.js`) và `App/web/tracker.js`, nên sửa app rồi tải lại trang là thấy kết quả mới.

Khởi động lại web sau khi build DLL để thấy v3 trong các trang thử ảnh/đánh giá.
Mở `/algorithms` để đọc quy trình và giới hạn; `/try?version=v3` chọn sẵn v3.
Các phép đo trên desktop chưa đại diện cho mobile. Báo cáo so sánh lưu tại `Core/reports/`.
