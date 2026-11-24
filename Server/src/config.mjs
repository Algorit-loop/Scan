// Cấu hình server, đọc từ biến môi trường (có mặc định cho máy phát triển).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  /** Cổng nghe. App (Expo Go) mặc định gọi http://<IP máy tính đang chạy Metro>:4000. */
  port: Number(process.env.PORT || 4000),
  /** 0.0.0.0: nhận kết nối từ điện thoại trong cùng mạng LAN. */
  host: process.env.HOST || '0.0.0.0',
  /** File SQLite (tự tạo). */
  dbPath: process.env.DB_PATH || join(root, 'data', 'app.db'),
  /** Phiên đăng nhập hết hạn sau số ngày này kể từ lần dùng cuối. */
  sessionDays: Number(process.env.SESSION_DAYS || 90),
  /** Giới hạn thử đăng nhập sai / đăng ký theo địa chỉ (chống dò mật khẩu, spam). */
  limits: {
    loginFailures: { max: 10, windowMs: 15 * 60 * 1000 },
    registrations: { max: 20, windowMs: 60 * 60 * 1000 },
  },
  /** Thân request tối đa (byte). */
  maxBody: 10 * 1024,
};
