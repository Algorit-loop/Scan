# Server — đăng ký / đăng nhập cho Scan Trợ Giúp

Server **chỉ** lo tài khoản: đăng ký, đăng nhập, hồ sơ người dùng. Quét, nhận dạng chữ, đọc và lịch sử đều chạy và lưu
trên điện thoại; không có ảnh hay nội dung tài liệu nào được gửi lên đây.

Node thuần, **không cần cài gói nào**: HTTP của Node, SQLite có sẵn (`node:sqlite`, Node ≥ 22.13), băm mật khẩu bằng
`scrypt` của `node:crypto`.

## Chạy

```powershell
.\Server\run.ps1                 # từ thư mục gốc dự án; nghe ở cổng 4000, mọi địa chỉ của máy
$env:PORT = 4001; .\Server\run.ps1
```

Lúc khởi động server in ra các địa chỉ dùng được từ điện thoại (`http://<IP máy tính>:4000`). Điện thoại và máy tính
phải cùng mạng Wi-Fi; lần đầu Windows có thể hỏi cho phép Node nhận kết nối — chọn cho phép với mạng riêng.

App (Expo Go) tự gọi `http://<máy tính đang chạy Expo>:4000`, nên chạy server trên cùng máy với `npx expo start` là đủ.
Muốn dùng địa chỉ khác: mục **Máy chủ** ở màn đăng nhập / Cài đặt của app, hoặc đặt `EXPO_PUBLIC_API_URL` khi chạy Expo.

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `4000` | cổng nghe |
| `HOST` | `0.0.0.0` | địa chỉ nghe (`127.0.0.1`: chỉ máy này) |
| `DB_PATH` | `Server/data/app.db` | file SQLite (tự tạo; `:memory:` cho test) |
| `SESSION_DAYS` | `90` | phiên đăng nhập hết hạn sau số ngày không dùng |

## API

Mọi thân request / response là JSON. Lỗi: `{ "error": { "code", "message", "field"? } }` — `message` tiếng Việt, app hiện
thẳng cho người dùng; `field` là ô nhập gây lỗi.

| | Đường dẫn | Vào | Ra |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` | `201 { token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | `200 { token, user }` |
| POST | `/api/auth/logout` | Bearer | `204` |
| GET | `/api/me` | Bearer | `200 { user }` |
| PATCH | `/api/me` | Bearer, `{ name?, email?, currentPassword? }` | `200 { user }` (đổi email cần `currentPassword`) |
| POST | `/api/me/password` | Bearer, `{ currentPassword, newPassword }` | `204` (các máy khác bị đăng xuất) |
| DELETE | `/api/me` | Bearer, `{ password }` | `204` (xóa tài khoản) |
| GET | `/api/health` | | `200 { ok, time }` |

`user = { id, email, name, createdAt }`. "Bearer" = header `Authorization: Bearer <token>`.

Đăng ký chưa xác minh email (theo yêu cầu hiện tại): ai cũng đăng ký được bằng email bất kỳ.

## Bảo mật đã làm

- Mật khẩu: 8-128 ký tự, lưu bằng `scrypt` (N = 32768) + muối riêng; không bao giờ ghi ra log hay trả về.
- Token phiên: 32 byte ngẫu nhiên; cơ sở dữ liệu chỉ giữ SHA-256 của token. Hết hạn sau 90 ngày không dùng, tự gia hạn
  khi còn dùng; đăng xuất / đổi mật khẩu / xóa tài khoản hủy token.
- Đăng nhập sai email và sai mật khẩu trả cùng một lỗi, cùng thời gian xử lý (không lộ email nào đã đăng ký).
- Chặn tạm khi đăng nhập sai 10 lần / 15 phút (theo địa chỉ + email) và đăng ký quá 20 lần / giờ (theo địa chỉ).
- Thân request tối đa 10 KB; request treo bị cắt sau 15 giây.

Chưa làm (cần trước khi đưa ra Internet): HTTPS (đặt sau một reverse proxy có chứng chỉ), xác minh email, quên mật khẩu,
giới hạn tần suất dùng chung giữa nhiều tiến trình.

## Kiểm tra

```powershell
. .\activate.ps1; cd Server; npm test       # 11 test, mỗi test một server thật + SQLite trong bộ nhớ
cd ..\App; npx jest auth.integration          # code đăng nhập của app gọi vào server thật
```

```
Server/
├── src/index.mjs       điểm vào: mở DB, nghe cổng, in địa chỉ LAN
├── src/app.mjs         định tuyến + xử lý từng API, giới hạn tần suất
├── src/db.mjs          lược đồ SQLite (users, sessions) + các truy vấn
├── src/passwords.mjs   scrypt, token
├── src/validate.mjs    kiểm tra dữ liệu vào, thông báo lỗi tiếng Việt
├── src/config.mjs      cấu hình từ biến môi trường
├── test/api.test.mjs
└── data/               file SQLite (không commit)
```
