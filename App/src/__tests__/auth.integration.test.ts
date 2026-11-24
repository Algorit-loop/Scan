/**
 * Test tích hợp: code đăng nhập của app (src/auth/api.ts + session.ts) gọi vào server THẬT (../Server, chạy bằng một
 * tiến trình Node riêng với SQLite trong bộ nhớ). Kho lưu trên máy (AsyncStorage, SecureStore) được thay bằng Map.
 */
import { ApiError, setServerUrl } from '../auth/api';
import { changePassword, deleteAccount, getAuthState, restoreSession, signIn, signOut, signUp, updateProfile } from '../auth/session';

// Module của Node (chỉ có trong môi trường test, dự án không cài @types/node): nạp bằng require, kiểu lỏng.
/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const http = require('node:http');
const { join } = require('node:path');
/* eslint-enable @typescript-eslint/no-require-imports */
declare const Buffer: any;
declare const __dirname: string;
const node = process as any;

jest.mock('@react-native-async-storage/async-storage', () => {
  const m = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
      removeItem: async (k: string) => void m.delete(k),
    },
  };
});
jest.mock('expo-secure-store', () => {
  const m = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => m.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void m.set(k, v),
    deleteItemAsync: async (k: string) => void m.delete(k),
  };
});
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { hostUri: '127.0.0.1:8081' } } }));

// Môi trường test của React Native thay fetch bằng bản giả; thay lại bằng một fetch tối giản đi qua mạng thật
// (node:http) với đúng phần giao diện mà api.ts dùng: method, headers, body, signal -> { status, ok, json() }.
globalThis.fetch = ((url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}) =>
  new Promise((resolve, reject) => {
    // Node không tự gửi độ dài thân cho DELETE: ghi rõ (fetch thật của điện thoại luôn gửi).
    const headers = { ...init.headers, ...(init.body ? { 'content-length': String(Buffer.byteLength(init.body)) } : {}) };
    const req = http.request(url, { method: init.method ?? 'GET', headers }, (res: any) => {
      const chunks: unknown[] = [];
      res.on('data', (c: unknown) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      });
    });
    req.on('error', () => reject(new TypeError('Network request failed')));
    init.signal?.addEventListener('abort', () => {
      req.destroy();
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    });
    req.end(init.body);
  })) as unknown as typeof fetch;

const PORT = 4300 + Math.floor(Math.random() * 400);
const AN = { name: 'Nguyễn Văn An', email: 'an@example.com', password: 'matkhau-123' };
let server: any;

const user = () => {
  const s = getAuthState();
  return s.status === 'signedIn' ? s.user : null;
};

/** Chạy `fn`, trả lỗi ApiError nó ném ra (test trượt nếu không ném). */
async function failure(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('lẽ ra phải báo lỗi');
}

beforeAll(async () => {
  server = spawn(node.execPath, [join(__dirname, '../../../Server/src/index.mjs')], {
    env: { ...node.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: ':memory:' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server không khởi động')), 15000);
    server.stdout.on('data', (d: unknown) => {
      if (String(d).includes('đang chạy')) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on('data', (d: unknown) => console.error(String(d)));
    server.on('exit', (code: number | null) => reject(new Error(`server thoát sớm (${code})`)));
  });
  await setServerUrl(`http://127.0.0.1:${PORT}`);
}, 20000);

afterAll(() => {
  server?.kill();
});

test('mở app lần đầu: chưa có phiên -> chưa đăng nhập', async () => {
  await restoreSession();
  expect(getAuthState().status).toBe('signedOut');
});

test('đăng ký -> đăng nhập ngay; lỗi của server tới app kèm trường sai', async () => {
  const bad = await failure(() => signUp({ ...AN, password: 'ngan' }));
  expect(bad).toMatchObject({ code: 'INVALID_INPUT', field: 'password', status: 400 });
  expect(getAuthState().status).toBe('signedOut');

  await signUp(AN);
  expect(user()).toMatchObject({ name: AN.name, email: AN.email });

  const dup = await failure(() => signUp(AN));
  expect(dup).toMatchObject({ code: 'EMAIL_TAKEN', field: 'email' });
  expect(dup.message).toMatch(/đã được đăng ký/);
});

test('đóng app rồi mở lại: phiên được khôi phục từ máy và server vẫn nhận token', async () => {
  await restoreSession();
  expect(user()?.email).toBe(AN.email);
  // restoreSession hỏi lại server ở nền; chờ nó xong rồi kiểm tra vẫn đăng nhập.
  await new Promise((r) => setTimeout(r, 300));
  expect(getAuthState().status).toBe('signedIn');
});

test('sửa thông tin: đổi tên; đổi email cần đúng mật khẩu', async () => {
  await updateProfile({ name: 'An Nguyễn' });
  expect(user()?.name).toBe('An Nguyễn');

  const wrong = await failure(() => updateProfile({ email: 'an2@example.com', currentPassword: 'sai-mat-khau' }));
  expect(wrong).toMatchObject({ code: 'WRONG_PASSWORD', field: 'currentPassword' });
  expect(user()?.email).toBe(AN.email);

  await updateProfile({ email: 'an2@example.com', currentPassword: AN.password });
  expect(user()?.email).toBe('an2@example.com');
});

test('đổi mật khẩu rồi đăng xuất, đăng nhập lại bằng mật khẩu mới', async () => {
  await changePassword({ currentPassword: AN.password, newPassword: 'matkhau-moi-456' });
  expect(getAuthState().status).toBe('signedIn');
  await signOut();
  expect(getAuthState().status).toBe('signedOut');

  const old = await failure(() => signIn({ email: 'an2@example.com', password: AN.password }));
  expect(old).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
  await signIn({ email: 'an2@example.com', password: 'matkhau-moi-456' });
  expect(user()?.name).toBe('An Nguyễn');
});

test('xóa tài khoản -> bị đăng xuất, không đăng nhập lại được', async () => {
  await deleteAccount('matkhau-moi-456');
  expect(getAuthState().status).toBe('signedOut');
  expect((await failure(() => signIn({ email: 'an2@example.com', password: 'matkhau-moi-456' }))).status).toBe(401);
});

test('không tới được máy chủ: báo lỗi mạng dễ hiểu, không treo', async () => {
  await setServerUrl('http://127.0.0.1:9'); // cổng không có ai nghe
  const e = await failure(() => signIn({ email: AN.email, password: AN.password }));
  expect(e.code).toBe('NETWORK');
  expect(e.message).toMatch(/Không kết nối được máy chủ/);
  expect(getAuthState().status).toBe('signedOut');
});
