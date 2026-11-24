# Quy tắc làm việc

## 1. Phân vai: Claude dev, người dùng test trên điện thoại

- Claude viết code và kiểm tra mọi thứ chạy được trên máy tính: typecheck, lint, test, build, script so khớp, trình duyệt headless.
- Claude **không chạy thử được trên điện thoại**. Việc thử trên máy thật (Expo Go) do người dùng làm.
- Khi báo xong một thay đổi, Claude ghi rõ phần nào đã kiểm tra trên máy tính và phần nào cần người dùng thử trên điện thoại (thao tác cần làm, kết quả mong đợi).

## 2. Nạp code mới vào app (Expo Go)

Mỗi lần báo xong, Claude ghi rõ cần mức nào trong ba mức dưới (Claude đã tự chạy `npm install` / `npm run build:web` nếu cần):

| Claude đã sửa gì | Người dùng làm gì |
|---|---|
| Chỉ file trong `App/src/` | Không cần gì (app tự nạp lại). Nếu không thấy đổi: nhấn `r` trong terminal đang chạy Expo. |
| File trong `App/web/` (Claude đã chạy `npm run build:web`) | Nhấn `r` trong terminal Expo. |
| `metro.config.js`, `app.json`, cài thêm package, thêm/đổi file model trong `App/assets/` | Dừng Expo (`Ctrl+C`) rồi chạy lại có xóa cache: `. .\activate.ps1; cd App; npx expo start -c` và quét lại QR. |

Khi nghi app vẫn chạy code cũ: làm mức cuối (dừng, `npx expo start -c`), rồi vuốt tắt hẳn Expo Go trên điện thoại và mở lại.

Khi có lỗi: chép các dòng log trong terminal Expo (nhất là dòng bắt đầu bằng `[layout]` và dòng màu đỏ) gửi cho Claude.

## 3. Commit

- Message commit chỉ gồm **tiêu đề + mô tả**.
- Không ghi tác giả là Claude: không có dòng `Co-Authored-By`, không có "Generated with Claude Code" hay chữ ký tương tự.

.\AndroidApp\scripts\build-apk.ps1
