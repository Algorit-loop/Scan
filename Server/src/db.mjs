// Cơ sở dữ liệu: SQLite có sẵn trong Node (node:sqlite), một file, không cần cài gì thêm.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,      -- đã chuẩn hóa: bỏ khoảng trắng, chữ thường
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- scrypt, xem passwords.mjs
  created_at    INTEGER NOT NULL,          -- ms từ 1970
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,           -- SHA-256 của token; token gốc chỉ nằm trên điện thoại
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;

/** Mở (và tạo nếu chưa có) cơ sở dữ liệu ở `path`; ':memory:' cho test. */
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Các câu truy vấn dùng trong app (chuẩn bị sẵn một lần). */
export function createStore(db) {
  const q = {
    insertUser: db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    updateProfile: db.prepare('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?'),
    updatePassword: db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    sessionByHash: db.prepare('SELECT * FROM sessions WHERE token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };
  return {
    createUser: (u) => q.insertUser.run(u.id, u.email, u.name, u.passwordHash, u.createdAt, u.createdAt),
    findUserByEmail: (email) => q.userByEmail.get(email),
    findUserById: (id) => q.userById.get(id),
    updateProfile: (id, name, email, now) => q.updateProfile.run(name, email, now, id),
    updatePassword: (id, hash, now) => q.updatePassword.run(hash, now, id),
    deleteUser: (id) => q.deleteUser.run(id),
    createSession: (s) => q.insertSession.run(s.tokenHash, s.userId, s.now, s.now, s.expiresAt),
    findSession: (hash) => q.sessionByHash.get(hash),
    touchSession: (hash, now, expiresAt) => q.touchSession.run(now, expiresAt, hash),
    deleteSession: (hash) => q.deleteSession.run(hash),
    deleteOtherSessions: (userId, keepHash) => q.deleteOtherSessions.run(userId, keepHash),
    deleteExpiredSessions: (now) => q.deleteExpired.run(now),
  };
}
