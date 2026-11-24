// API đăng ký / đăng nhập / hồ sơ người dùng. Server CHỈ làm việc này: quét, nhận dạng chữ, lịch sử đều nằm trên điện thoại.
//
//   POST   /api/auth/register  { name, email, password }            -> 201 { token, user }
//   POST   /api/auth/login     { email, password }                   -> 200 { token, user }
//   POST   /api/auth/logout    (Bearer)                              -> 204
//   GET    /api/me             (Bearer)                              -> 200 { user }
//   PATCH  /api/me             (Bearer) { name?, email?, currentPassword? }  -> 200 { user }   (đổi email cần mật khẩu)
//   POST   /api/me/password    (Bearer) { currentPassword, newPassword }     -> 204            (đăng xuất các máy khác)
//   DELETE /api/me             (Bearer) { password }                 -> 204                    (xóa tài khoản)
//   GET    /api/health                                               -> 200 { ok, time }
//
// Lỗi: { error: { code, message, field? } } — message tiếng Việt, hiện thẳng cho người dùng.
import { randomUUID } from 'node:crypto';

import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from './passwords.mjs';
import * as v from './validate.mjs';
import { ApiError } from './validate.mjs';

const DAY = 24 * 60 * 60 * 1000;

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });

/** Đếm số lần theo khóa trong một cửa sổ thời gian (trong bộ nhớ; đủ cho một tiến trình server). */
function createLimiter({ max, windowMs }, now) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      return !!h && h.resetAt > now() && h.count >= max;
    },
    hit(key) {
      const t = now();
      const h = hits.get(key);
      if (!h || h.resetAt <= t) hits.set(key, { count: 1, resetAt: t + windowMs });
      else h.count++;
      if (hits.size > 10000) for (const [k, e] of hits) if (e.resetAt <= t) hits.delete(k);
    },
    clear: (key) => hits.delete(key),
  };
}

/**
 * Tạo hàm xử lý request cho http.createServer.
 * @param {{ store: ReturnType<import('./db.mjs').createStore>, config: typeof import('./config.mjs').config, now?: () => number, log?: (line: string) => void }} deps
 */
export function createApp({ store, config, now = Date.now, log = () => {} }) {
  const loginFailures = createLimiter(config.limits.loginFailures, now);
  const registrations = createLimiter(config.limits.registrations, now);
  const sessionMs = config.sessionDays * DAY;

  function startSession(userId) {
    const token = newToken();
    const t = now();
    store.createSession({ tokenHash: hashToken(token), userId, now: t, expiresAt: t + sessionMs });
    return token;
  }

  /** Người dùng của request (theo Bearer token) hoặc ném 401. */
  function authenticate(req) {
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
    if (!m) throw new ApiError(401, 'UNAUTHENTICATED', 'Cần đăng nhập.');
    const tokenHash = hashToken(m[1]);
    const session = store.findSession(tokenHash);
    const t = now();
    if (!session || session.expires_at < t) {
      if (session) store.deleteSession(tokenHash);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');
    }
    const user = store.findUserById(session.user_id);
    if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Tài khoản không còn tồn tại.');
    // Gia hạn khi còn dùng (ghi tối đa mỗi giờ một lần).
    if (t - session.last_used_at > 60 * 60 * 1000) store.touchSession(tokenHash, t, t + sessionMs);
    return { user, tokenHash };
  }

  async function checkPassword(user, password, field) {
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new ApiError(403, 'WRONG_PASSWORD', 'Mật khẩu hiện tại không đúng.', field);
    }
  }

  const routes = {
    'GET /api/health': async () => ({ status: 200, body: { ok: true, time: new Date(now()).toISOString() } }),

    'POST /api/auth/register': async ({ body, ip }) => {
      if (registrations.blocked(ip)) throw new ApiError(429, 'TOO_MANY_REQUESTS', 'Đăng ký quá nhiều lần. Hãy thử lại sau.');
      const name = v.name(body.name);
      const email = v.email(body.email);
      const password = v.newPassword(body.password);
      if (store.findUserByEmail(email)) throw new ApiError(409, 'EMAIL_TAKEN', 'Email này đã được đăng ký. Hãy đăng nhập.', 'email');
      registrations.hit(ip);
      const user = { id: randomUUID(), email, name, passwordHash: await hashPassword(password), createdAt: now() };
      try {
        store.createUser(user);
      } catch (e) {
        // Hai request cùng email chạy đồng thời: ràng buộc UNIQUE chặn cái thứ hai.
        if (String(e.message).includes('UNIQUE')) throw new ApiError(409, 'EMAIL_TAKEN', 'Email này đã được đăng ký. Hãy đăng nhập.', 'email');
        throw e;
      }
      return { status: 201, body: { token: startSession(user.id), user: publicUser(store.findUserById(user.id)) } };
    },

    'POST /api/auth/login': async ({ body, ip }) => {
      const email = v.email(body.email);
      const password = v.password(body.password);
      const key = `${ip}|${email}`;
      if (loginFailures.blocked(key)) {
        throw new ApiError(429, 'TOO_MANY_REQUESTS', 'Đăng nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.');
      }
      const user = store.findUserByEmail(email);
      // Luôn băm một lần để thời gian trả lời không cho biết email có tồn tại hay không.
      const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok) {
        loginFailures.hit(key);
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
      }
      loginFailures.clear(key);
      store.deleteExpiredSessions(now());
      return { status: 200, body: { token: startSession(user.id), user: publicUser(user) } };
    },

    'POST /api/auth/logout': async ({ req }) => {
      const { tokenHash } = authenticate(req);
      store.deleteSession(tokenHash);
      return { status: 204 };
    },

    'GET /api/me': async ({ req }) => ({ status: 200, body: { user: publicUser(authenticate(req).user) } }),

    'PATCH /api/me': async ({ req, body }) => {
      const { user } = authenticate(req);
      const name = body.name === undefined ? user.name : v.name(body.name);
      const email = body.email === undefined ? user.email : v.email(body.email);
      if (email !== user.email) {
        // Email là tên đăng nhập: đổi phải xác nhận bằng mật khẩu.
        await checkPassword(user, v.password(body.currentPassword, 'currentPassword'), 'currentPassword');
        if (store.findUserByEmail(email)) throw new ApiError(409, 'EMAIL_TAKEN', 'Email này đã có người dùng.', 'email');
      }
      store.updateProfile(user.id, name, email, now());
      return { status: 200, body: { user: publicUser(store.findUserById(user.id)) } };
    },

    'POST /api/me/password': async ({ req, body }) => {
      const { user, tokenHash } = authenticate(req);
      const current = v.password(body.currentPassword, 'currentPassword');
      const next = v.newPassword(body.newPassword, 'newPassword');
      await checkPassword(user, current, 'currentPassword');
      store.updatePassword(user.id, await hashPassword(next), now());
      store.deleteOtherSessions(user.id, tokenHash); // máy này vẫn đăng nhập, các máy khác phải đăng nhập lại
      return { status: 204 };
    },

    'DELETE /api/me': async ({ req, body }) => {
      const { user } = authenticate(req);
      await checkPassword(user, v.password(body.password), 'password');
      store.deleteUser(user.id); // phiên đăng nhập bị xóa theo (ON DELETE CASCADE)
      return { status: 204 };
    },
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      if (req.method === 'GET') return resolve({});
      const chunks = [];
      let size = 0;
      const onData = (c) => {
        size += c.length;
        if (size > config.maxBody) {
          // Ngừng gom, bỏ phần còn lại (vẫn đọc cho hết để còn trả lời được 413).
          req.off('data', onData);
          req.resume();
          reject(new ApiError(413, 'TOO_LARGE', 'Dữ liệu gửi lên quá lớn.'));
        } else chunks.push(c);
      };
      req.on('data', onData);
      req.on('error', reject);
      req.on('end', () => {
        if (size > config.maxBody) return;
        if (!size) return resolve({});
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
          resolve(data);
        } catch {
          reject(new ApiError(400, 'INVALID_JSON', 'Dữ liệu gửi lên không đúng định dạng.'));
        }
      });
    });
  }

  function send(res, status, body) {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      'cache-control': 'no-store',
    });
    res.end(text);
  }

  return async function handle(req, res) {
    const started = now();
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const ip = req.socket.remoteAddress || 'unknown';
    let status = 500;
    try {
      const route = routes[`${req.method} ${path}`];
      if (!route) {
        const known = Object.keys(routes).some((k) => k.endsWith(` ${path}`));
        throw known ? new ApiError(405, 'METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ.') : new ApiError(404, 'NOT_FOUND', 'Không tìm thấy.');
      }
      const body = await readBody(req);
      const result = await route({ req, body, ip });
      status = result.status;
      send(res, status, result.body);
    } catch (e) {
      if (e instanceof ApiError) {
        status = e.status;
        send(res, status, { error: { code: e.code, message: e.message, ...(e.field ? { field: e.field } : {}) } });
      } else {
        status = 500;
        log(`LỖI ${req.method} ${path}: ${e && e.stack ? e.stack : e}`);
        if (!res.headersSent) send(res, 500, { error: { code: 'INTERNAL', message: 'Máy chủ gặp lỗi. Hãy thử lại sau.' } });
      }
    }
    // Không ghi thân request (có mật khẩu) hay token ra log.
    log(`${req.method} ${path} ${status} ${now() - started}ms ${ip}`);
  };
}
