# Scan Trợ Giúp

App giúp người khiếm thị quét tài liệu: hướng dẫn bằng giọng nói và rung cho tới khi tài liệu nằm đúng khung, rồi chụp lại thành ảnh phẳng, rõ.

## Cấu trúc

```
Scan/
├── App/    app điện thoại (Expo): src/, assets/, package.json
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
├── scripts/build-web.mjs    gói web/ + engine -> src/scanner/page.generated.ts
└── src/app/                 index (trang chủ), scan (màn quét), result (ảnh nắn phẳng)
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
