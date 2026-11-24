// Điểm vào: node src/index.mjs  (hoặc .\run.ps1 từ thư mục gốc dự án)
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';

import { createApp } from './app.mjs';
import { config } from './config.mjs';
import { createStore, openDatabase } from './db.mjs';

const db = openDatabase(config.dbPath);
const stamp = () => new Date().toISOString().slice(11, 19);
const app = createApp({ store: createStore(db), config, log: (line) => console.log(`${stamp()} ${line}`) });

const server = createServer(app);
// Kết nối treo không được giữ mãi.
server.requestTimeout = 15000;
server.headersTimeout = 10000;

server.listen(config.port, config.host, () => {
  console.log(`Server Scan Trợ Giúp (đăng ký / đăng nhập) đang chạy, cơ sở dữ liệu: ${config.dbPath}`);
  console.log(`  Trên máy này:      http://localhost:${config.port}/api/health`);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Từ điện thoại (LAN): http://${a.address}:${config.port}`);
    }
  }
  console.log('Điện thoại phải cùng mạng Wi-Fi với máy này. Dừng: Ctrl+C.');
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Cổng ${config.port} đang bị chương trình khác dùng (đặt PORT=... để đổi).` : e);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // Còn kết nối giữ sống thì không chờ quá 2 giây.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
