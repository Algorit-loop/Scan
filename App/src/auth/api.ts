import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { SERVER_PORT } from './url';

export { normalizeServerUrl } from './url';

/**
 * Gọi server đăng ký / đăng nhập (thư mục Server/ của dự án). Server CHỈ lo tài khoản; quét, nhận dạng chữ, lịch sử
 * đều chạy và lưu trên điện thoại.
 *
 * Địa chỉ server, theo thứ tự ưu tiên:
 *   1. địa chỉ người dùng tự nhập (màn đăng nhập / Cài đặt), lưu trên máy;
 *   2. biến môi trường EXPO_PUBLIC_API_URL lúc chạy `expo start` (bản phát hành đặt ở đây);
 *   3. khi chạy bằng Expo Go: cùng máy tính đang chạy Metro, cổng 4000 — điện thoại đã nối được tới máy đó rồi.
 */

export type User = { id: string; email: string; name: string; createdAt: number };
export type Session = { token: string; user: User };

/** Lỗi có thông báo tiếng Việt để hiện thẳng cho người dùng. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** Mã lỗi của server (INVALID_INPUT, EMAIL_TAKEN...), hoặc NETWORK / TIMEOUT / BAD_RESPONSE phía app. */
    readonly code: string,
    /** Mã HTTP (0: không tới được server). */
    readonly status: number,
    /** Trường nhập liệu gây lỗi, nếu server chỉ ra. */
    readonly field?: string,
  ) {
    super(message);
  }
}

const URL_KEY = 'server-url-v1';
const TIMEOUT_MS = 10000;
let override: string | null | undefined; // undefined: chưa đọc từ bộ nhớ máy

/** Địa chỉ mặc định (không tính địa chỉ người dùng tự nhập). */
export function defaultServerUrl(): string {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/+$/, '');
  // Expo Go: hostUri = "192.168.1.5:8081" (máy tính chạy Metro).
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${SERVER_PORT}`;
}

export async function getServerUrl(): Promise<string> {
  if (override === undefined) override = await AsyncStorage.getItem(URL_KEY).catch(() => null);
  return override || defaultServerUrl();
}

/** Đặt địa chỉ server tự nhập (null / rỗng: quay về mặc định). Trả địa chỉ đang dùng. */
export async function setServerUrl(url: string | null): Promise<string> {
  override = url || null;
  if (override) await AsyncStorage.setItem(URL_KEY, override);
  else await AsyncStorage.removeItem(URL_KEY);
  return override || defaultServerUrl();
}

async function request<T>(method: string, path: string, body?: object, token?: string): Promise<T> {
  const base = await getServerUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = (e as Error).name === 'AbortError';
    throw new ApiError(
      timedOut
        ? `Máy chủ không trả lời (${base}). Kiểm tra mạng rồi thử lại.`
        : `Không kết nối được máy chủ (${base}). Kiểm tra mạng, và máy chủ đã bật chưa.`,
      timedOut ? 'TIMEOUT' : 'NETWORK',
      0,
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`Máy chủ trả lời không đúng định dạng (${base}).`, 'BAD_RESPONSE', res.status);
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(err?.message || `Máy chủ báo lỗi ${res.status}.`, err?.code || 'HTTP_ERROR', res.status, err?.field);
  }
  return data as T;
}

export const api = {
  register: (input: { name: string; email: string; password: string }) => request<Session>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string }) => request<Session>('POST', '/api/auth/login', input),
  logout: (token: string) => request<void>('POST', '/api/auth/logout', undefined, token),
  me: (token: string) => request<{ user: User }>('GET', '/api/me', undefined, token),
  updateProfile: (token: string, input: { name?: string; email?: string; currentPassword?: string }) =>
    request<{ user: User }>('PATCH', '/api/me', input, token),
  changePassword: (token: string, input: { currentPassword: string; newPassword: string }) =>
    request<void>('POST', '/api/me/password', input, token),
  deleteAccount: (token: string, password: string) => request<void>('DELETE', '/api/me', { password }, token),
  health: () => request<{ ok: boolean }>('GET', '/api/health'),
};
