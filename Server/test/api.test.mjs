// Chạy: node --test   (từ Server/). Mỗi test dùng một server thật trên cổng ngẫu nhiên + SQLite trong bộ nhớ.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';

import { createApp } from '../src/app.mjs';
import { config as baseConfig } from '../src/config.mjs';
import { createStore, openDatabase } from '../src/db.mjs';

let server;
let base;
let db;
let clock;

beforeEach(async () => {
  db = openDatabase(':memory:');
  clock = { t: Date.UTC(2026, 10, 24) };
  const app = createApp({ store: createStore(db), config: baseConfig, now: () => clock.t });
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  db.close();
});

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const AN = { name: 'Nguyễn Văn An', email: 'an@example.com', password: 'matkhau-123' };
const register = (u = AN) => call('POST', '/api/auth/register', u);

test('đăng ký -> nhận token + hồ sơ, không trả mật khẩu', async () => {
  const r = await register({ ...AN, email: '  An@Example.COM ', name: '  Nguyễn   Văn An ' });
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(r.body.user.email, 'an@example.com');
  assert.equal(r.body.user.name, 'Nguyễn Văn An');
  assert.deepEqual(Object.keys(r.body.user).sort(), ['createdAt', 'email', 'id', 'name']);
});

test('mật khẩu và token không lưu dạng gốc trong cơ sở dữ liệu', async () => {
  const r = await register();
  const user = db.prepare('SELECT * FROM users').get();
  assert.match(user.password_hash, /^scrypt\$/);
  assert.ok(!user.password_hash.includes(AN.password));
  const session = db.prepare('SELECT * FROM sessions').get();
  assert.notEqual(session.token_hash, r.body.token);
  assert.match(session.token_hash, /^[0-9a-f]{64}$/);
});

test('đăng ký: báo lỗi theo từng trường, email trùng -> 409', async () => {
  assert.deepEqual((await register({ ...AN, email: 'khong-phai-email' })).body.error, {
    code: 'INVALID_INPUT',
    message: 'Email không hợp lệ.',
    field: 'email',
  });
  assert.equal((await register({ ...AN, password: '1234567' })).body.error.field, 'password');
  assert.equal((await register({ ...AN, name: '   ' })).body.error.field, 'name');
  assert.equal((await register()).status, 201);
  const dup = await register({ ...AN, email: 'AN@example.com' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'EMAIL_TAKEN');
});

test('đăng nhập đúng / sai; sai email và sai mật khẩu trả cùng một lỗi', async () => {
  await register();
  const ok = await call('POST', '/api/auth/login', { email: 'AN@example.com ', password: AN.password });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, AN.name);
  const wrongPassword = await call('POST', '/api/auth/login', { email: AN.email, password: 'sai-mat-khau' });
  const wrongEmail = await call('POST', '/api/auth/login', { email: 'ai-do@example.com', password: AN.password });
  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.body, wrongEmail.body);
});

test('đăng nhập sai quá nhiều lần bị chặn tạm, hết thời gian thì được thử lại', async () => {
  await register();
  const bad = { email: AN.email, password: 'sai-mat-khau' };
  for (let i = 0; i < baseConfig.limits.loginFailures.max; i++) assert.equal((await call('POST', '/api/auth/login', bad)).status, 401);
  // Đã bị chặn: kể cả mật khẩu đúng cũng phải chờ.
  assert.equal((await call('POST', '/api/auth/login', { email: AN.email, password: AN.password })).status, 429);
  clock.t += baseConfig.limits.loginFailures.windowMs + 1;
  assert.equal((await call('POST', '/api/auth/login', { email: AN.email, password: AN.password })).status, 200);
});

test('/api/me cần token hợp lệ; đăng xuất làm token hết hiệu lực', async () => {
  const { token } = (await register()).body;
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', null, 'token-bia-khong-co-trong-he-thong')).status, 401);
  assert.equal((await call('GET', '/api/me', null, token)).body.user.email, AN.email);
  assert.equal((await call('POST', '/api/auth/logout', null, token)).status, 204);
  assert.equal((await call('GET', '/api/me', null, token)).status, 401);
});

test('phiên đăng nhập hết hạn sau thời gian không dùng, còn dùng thì được gia hạn', async () => {
  const { token } = (await register()).body;
  const day = 24 * 60 * 60 * 1000;
  clock.t += (baseConfig.sessionDays - 1) * day;
  assert.equal((await call('GET', '/api/me', null, token)).status, 200); // gia hạn từ đây
  clock.t += (baseConfig.sessionDays - 1) * day;
  assert.equal((await call('GET', '/api/me', null, token)).status, 200);
  clock.t += (baseConfig.sessionDays + 1) * day;
  assert.equal((await call('GET', '/api/me', null, token)).status, 401);
});

test('đổi tên không cần mật khẩu; đổi email cần mật khẩu hiện tại và không được trùng', async () => {
  const { token } = (await register()).body;
  await register({ name: 'Bình', email: 'binh@example.com', password: 'matkhau-456' });

  const renamed = await call('PATCH', '/api/me', { name: 'An Nguyễn' }, token);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.user.name, 'An Nguyễn');

  assert.equal((await call('PATCH', '/api/me', { email: 'an2@example.com' }, token)).status, 400);
  const wrong = await call('PATCH', '/api/me', { email: 'an2@example.com', currentPassword: 'sai-mat-khau' }, token);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error.field, 'currentPassword');
  const taken = await call('PATCH', '/api/me', { email: 'binh@example.com', currentPassword: AN.password }, token);
  assert.equal(taken.status, 409);
  const ok = await call('PATCH', '/api/me', { email: 'an2@example.com', currentPassword: AN.password }, token);
  assert.equal(ok.body.user.email, 'an2@example.com');
  assert.equal((await call('POST', '/api/auth/login', { email: 'an2@example.com', password: AN.password })).status, 200);
});

test('đổi mật khẩu: cần mật khẩu cũ; máy này giữ đăng nhập, máy khác bị đăng xuất', async () => {
  const here = (await register()).body.token;
  const other = (await call('POST', '/api/auth/login', { email: AN.email, password: AN.password })).body.token;

  assert.equal((await call('POST', '/api/me/password', { currentPassword: 'sai', newPassword: 'matkhau-moi-1' }, here)).status, 403);
  assert.equal((await call('POST', '/api/me/password', { currentPassword: AN.password, newPassword: 'ngan' }, here)).status, 400);
  assert.equal((await call('POST', '/api/me/password', { currentPassword: AN.password, newPassword: 'matkhau-moi-1' }, here)).status, 204);

  assert.equal((await call('GET', '/api/me', null, here)).status, 200);
  assert.equal((await call('GET', '/api/me', null, other)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: AN.email, password: AN.password })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: AN.email, password: 'matkhau-moi-1' })).status, 200);
});

test('xóa tài khoản cần mật khẩu; xóa xong token và email đều không dùng được, đăng ký lại được', async () => {
  const { token } = (await register()).body;
  assert.equal((await call('DELETE', '/api/me', { password: 'sai-mat-khau' }, token)).status, 403);
  assert.equal((await call('DELETE', '/api/me', { password: AN.password }, token)).status, 204);
  assert.equal((await call('GET', '/api/me', null, token)).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  assert.equal((await register()).status, 201);
});

test('request hỏng: JSON sai, thân quá lớn, đường dẫn / phương thức lạ', async () => {
  const raw = (body) => fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await raw('{không phải json')).status, 400);
  assert.equal((await raw('[1,2,3]')).status, 400);
  assert.equal((await raw(JSON.stringify({ email: AN.email, password: 'x'.repeat(20000) }))).status, 413);
  assert.equal((await call('GET', '/api/khong-co')).status, 404);
  assert.equal((await call('GET', '/api/auth/login')).status, 405);
  assert.equal((await call('GET', '/api/health')).body.ok, true);
});
