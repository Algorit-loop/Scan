# Scan Trợ Giúp

> **Trạng thái hiện tại:** đang tập trung vào server (`server/`). App tạm thời chỉ có danh sách ảnh và camera chụp ảnh; việc detect sẽ do server đảm nhận. Các module cũ (giọng nói, hướng dẫn, lưu trữ, màn chi tiết, kết nối server, detect trên máy) được để ở `src/_disabled/` — không được build, không lint, không typecheck — để gắn lại sau. Phần mô tả bên dưới là thiết kế cũ.

## Server (đang phát triển)

```
server/app/
  detection/        các phiên bản detect, mỗi phiên bản một package
    base.py           hợp đồng kết quả (found, corners, bbox, touches, confidence, method)
    v1/               detect v1: LSD → gộp đường → dựng tứ giác → chấm điểm (theo document/detect)
    metrics.py        chỉ số Jaccard để đo chất lượng
  routes/web.py     trang web kiểm tra: upload ảnh, chạy detect, lưu và xem lại kết quả
  routes/mobile.py  API cho app: /ws, /warp, /health
  storage.py        lưu kết quả vào server/data/detections/<id>/ (ảnh gốc, ảnh có khung, ảnh nắn phẳng, result.json)
```

- **Chạy:** `.\serverun.ps1`, rồi mở `http://localhost:8000/` để upload ảnh kiểm tra. Test: `server\.venv\Scripts\python -m pytest` (trong thư mục `server`).
- **Thêm phiên bản detect mới (v2...):** tạo package `app/detection/v2/` có một lớp với `version`, `name`, `description`, `detect(img)`; rồi `register(...)` trong `app/detection/__init__.py`. Trang web tự hiện phiên bản mới trong danh sách chọn; app chọn bằng trường `version` trong tin nhắn WebSocket (mặc định `DEFAULT_VERSION`).

App Expo giúp người khiếm thị quét tài liệu: hướng dẫn bằng giọng nói tiếng Việt và rung (trái/phải/lên/xuống/gần/xa) cho tới khi tài liệu nằm đúng khung, sau đó **chạm bất kỳ đâu** để chụp. Ảnh được lưu vào danh sách trong app.

Thiết kế chi tiết: [PLAN.md](PLAN.md).

## Kiến trúc

```
Điện thoại (Expo Go)                              Máy tính (server Python)
┌──────────────────────────────┐   khung ~20KB   ┌──────────────────────────┐
│ WebView camera (getUserMedia)│ ──────────────▶ │ WS /ws   : OpenCV tìm 4  │
│ → app → WebSocket            │ ◀────────────── │           góc tài liệu   │
│ hướng dẫn + giọng nói + rung │   4 góc + bbox  │ POST /warp: nắn phẳng ảnh│
└──────────────────────────────┘                 └──────────────────────────┘
```

- **Server** (`server/`): làm phần tính toán nặng. Hiện dùng OpenCV (tìm cạnh rồi lấy tứ giác lớn nhất), sau này có thể thay bằng model AI mà không phải sửa app.
- **App**: lo camera, giao diện, giọng nói và rung. Logic chọn câu hướng dẫn vẫn nằm trên app, vì nó rất nhẹ và cần dùng chung cho chế độ ngoại tuyến.
- **Dự phòng:**
  - Không có server: app tự nhận diện bằng thuật toán TypeScript (kém chính xác hơn).
  - WebView không mở được camera: app quay về `expo-camera` chụp ảnh liên tục (chậm hơn).

## Chạy thử

Mọi công cụ (Node, npm cache, Python venv, pip cache, state của Expo, file tạm) đều nằm trong folder này. Không cài gì global.

Mở **2 cửa sổ PowerShell** tại thư mục dự án:

```powershell
# Cửa sổ 1 — server
.\server\run.ps1

# Cửa sổ 2 — app
. .\activate.ps1
npx expo start            # quét QR bằng Expo Go
```

- Điện thoại và máy tính phải chung mạng Wi-Fi. App tự tìm server theo địa chỉ IP của Metro, cổng 8000.
- **Lần đầu chạy server**, Windows sẽ hỏi có cho Python qua tường lửa không: chọn **Private networks**.
- Kiểm tra từ điện thoại: mở trình duyệt, vào `http://<IP máy tính>:8000/health`. `server/run.ps1` có in sẵn địa chỉ này.
- iPhone: Expo CLI và Expo Go phải đăng nhập **cùng một tài khoản Expo**. Nếu `npx expo login` bị lỗi không mở được trình duyệt, chạy `$env:BROWSER='none'` trước rồi tự mở link mà lệnh in ra.

Lần đầu trên máy mới (chưa có `.tools/node`): tải Node LTS bản zip win-x64 từ nodejs.org, giải nén thành `.tools/node`, rồi chạy `. .\activate.ps1; npm install`. Venv của server sẽ được `server/run.ps1` tự tạo.

## Kiểm tra

```powershell
. .\activate.ps1
npm test                                         # test app (nhận diện, hướng dẫn, base64)
npm run typecheck
cd server; .\.venv\Scripts\python.exe -m pytest  # test server (OpenCV, WebSocket, /warp)
```

Màn quét có bảng số màu xanh ở góc trên bên phải (bật/tắt bằng `SHOW_PERF` trong `src/app/scan.tsx`):
- chế độ camera và trạng thái server;
- thời gian lấy khung, mạng + server, xử lý trên máy;
- số khung mỗi giây.

Terminal của `npx expo start` in dòng `[perf]` cho từng khung. Terminal của server in thời gian xử lý từng khung.

## Cấu trúc

| Đường dẫn | Vai trò |
|---|---|
| `src/app/` | Màn hình (expo-router): danh sách, quét, chi tiết |
| `src/scan/` | Logic của màn quét, tách thành hook: `useServerConnection` (kết nối server), `useFrameLoop` (lấy khung, nhận diện, hướng dẫn), `useGuidanceAnnouncer` (đọc và rung), `useCapture` (chụp, nắn phẳng, lưu); `config.ts` gom các hằng số |
| `src/camera/` | Camera trong WebView: trang HTML gọi getUserMedia và cắt khung hình |
| `src/server/serverClient.ts` | Kết nối WebSocket tới server, timeout, tự kết nối lại, gọi `/warp` |
| `src/detection/` | Nhận diện ngoại tuyến bằng TypeScript (dự phòng) |
| `src/guidance/` | Chọn chỉ dẫn, làm mượt theo thời gian, câu thoại tiếng Việt |
| `src/feedback/announcer.ts` | Giọng nói (không ngắt câu, có khoảng nghỉ) và rung |
| `src/storage/scans.ts` | Lưu ảnh vào Documents/scans, lưu danh sách trong AsyncStorage |
| `server/app/detector.py` | OpenCV: nhận diện tài liệu và nắn phẳng phối cảnh |
| `server/app/main.py` | FastAPI: `/ws`, `/warp`, `/health` |

## Tinh chỉnh nhanh

- **Chiều hướng dẫn:** `DIRECTION_MODE` trong `src/guidance/computeGuidance.ts`.
  - `'target'` (mặc định, theo yêu cầu ban đầu): tài liệu lệch phải thì app nói "sang trái".
  - `'phone'`: app nói hướng cần dời điện thoại.
- **Ngưỡng căn chỉnh:** `DEFAULT_GUIDANCE` (độ lệch tâm, tỉ lệ diện tích tối thiểu và tối đa).
- **Tốc độ, kích thước khung, thời gian chờ của màn quét:** `src/scan/config.ts`.
- **Nhịp đọc:** các hằng số ở đầu `src/feedback/announcer.ts` (khoảng nghỉ giữa các câu, khoảng lặp lại cùng một câu).
- **Thuật toán server:** `server/app/detector.py`. Định dạng kết quả phải giữ đúng kiểu `DetectionResult` của app (`src/detection/types.ts`).

## Giới hạn đã biết

- Camera trong WebView **chưa được kiểm chứng trên iPhone thật trong Expo Go**. Nếu không chạy được, app tự chuyển sang chế độ chụp ảnh và báo bằng giọng nói.
- Ảnh chụp cuối lấy từ luồng video, tối đa khoảng 1920×1080 (thấp hơn ảnh chụp bằng camera gốc). Khi có server, ảnh được nắn phẳng theo 4 góc.
- Khung hình được gửi tới server qua mạng nội bộ, chưa mã hóa (HTTP/WS). Chỉ dùng trong mạng tin cậy; muốn đưa server lên Internet thì phải thêm HTTPS/WSS.
- Khi bật VoiceOver hoặc TalkBack: chạm **hai lần** để chụp. Dòng chữ hướng dẫn trên màn hình được ẩn khỏi trình đọc màn hình để không đọc trùng với giọng nói của app.
