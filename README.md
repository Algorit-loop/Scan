# Scan Trợ Giúp

App giúp người khiếm thị quét tài liệu: hướng dẫn bằng giọng nói và rung cho tới khi tài liệu nằm đúng khung, rồi chụp lại thành ảnh phẳng, rõ.

## Thành phần

```
App điện thoại (Expo)  ──▶  Server (Python, FastAPI + OpenCV)  ◀──  Web admin (chạy trên server)
 người dùng cuối              xử lý ảnh: tìm 4 góc, nắn phẳng        dành cho admin / dev
```

| Thành phần | Thư mục | Vai trò |
|---|---|---|
| App | `src/` | Giao diện cho người dùng cuối: camera, danh sách ảnh. |
| Server | `server/` | Nơi xử lý ảnh nặng. Các thuật toán detect được tách thành nhiều phiên bản để so sánh và thay thế. |
| Web admin | `server/app/web/` | Kiểm tra chất lượng detect, đọc tài liệu dự án (tab **Document**), và là nền để phát triển thành trang quản lý. |

Người dùng cuối chỉ dùng app. Web admin là công cụ nội bộ cho người phát triển.

## Chạy thử

Mở 2 cửa sổ PowerShell tại thư mục dự án:

```powershell
.\server\run.ps1                   # server, rồi mở http://localhost:8000/
. .\activate.ps1; npx expo start   # app, quét QR bằng Expo Go
```

Điện thoại và máy tính cần chung mạng Wi-Fi. Lần đầu chạy, Windows có thể hỏi quyền tường lửa cho Python: chọn **Private networks**.

Kiểm thử server: `cd server; .\.venv\Scripts\python.exe -m pytest`.
Kiểm tra app: `npm run typecheck` và `npm run lint`.

## Tài liệu

- **Tab Document** trên web admin: các module, cách hoạt động, sơ đồ luồng dữ liệu và API. Đây là nơi duy nhất ghi chi tiết kỹ thuật, nằm cạnh code để sửa cùng lúc.
