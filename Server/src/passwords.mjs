// Băm mật khẩu bằng scrypt (có sẵn trong Node) + token phiên đăng nhập.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
// N = 2^15: ~50-100 ms / lần băm trên máy thường, đủ chậm để dò mật khẩu tốn kém.
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

/** Trả chuỗi lưu vào DB: scrypt$N$r$p$<salt base64url>$<hash base64url>. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** So mật khẩu với chuỗi đã lưu (thời gian so sánh không phụ thuộc nội dung). */
export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Chuỗi băm giả để vẫn tốn thời gian như thật khi email không tồn tại (không lộ email nào đã đăng ký). */
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

/** Token phiên: 32 byte ngẫu nhiên. Chỉ lưu SHA-256 của nó trong DB. */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
