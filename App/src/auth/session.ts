import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import { api, ApiError, type User } from './api';

/**
 * Phiên đăng nhập của app.
 *  - Token nằm trong kho bảo mật của máy (Keychain / Keystore qua expo-secure-store); hồ sơ người dùng (không bí mật)
 *    lưu ở AsyncStorage để mở app là có ngay, kể cả khi không có mạng.
 *  - Đăng ký / đăng nhập / đổi thông tin cần mạng (gọi server). Đã đăng nhập rồi thì dùng app không cần mạng: lúc mở
 *    app chỉ hỏi lại server ở chế độ nền; mất mạng thì giữ nguyên, chỉ khi server nói token hết hiệu lực mới đăng xuất.
 */
export type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User };

const TOKEN_KEY = 'auth-token-v1';
const USER_KEY = 'auth-user-v1';

let state: AuthState = { status: 'loading' };
let token: string | null = null;
const listeners = new Set<() => void>();

function set(next: AuthState) {
  state = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => state);
}

export function getAuthState(): AuthState {
  return state;
}

export function getUser(): User | null {
  return state.status === 'signedIn' ? state.user : null;
}

async function persist(nextToken: string, user: User) {
  token = nextToken;
  await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  set({ status: 'signedIn', user });
}

async function clear() {
  token = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
  await AsyncStorage.removeItem(USER_KEY).catch(() => {});
  set({ status: 'signedOut' });
}

/** Gọi một lần lúc mở app: khôi phục phiên đã lưu, rồi hỏi lại server ở nền. */
export async function restoreSession(): Promise<void> {
  try {
    const [savedToken, savedUser] = await Promise.all([SecureStore.getItemAsync(TOKEN_KEY), AsyncStorage.getItem(USER_KEY)]);
    if (!savedToken || !savedUser) return set({ status: 'signedOut' });
    token = savedToken;
    set({ status: 'signedIn', user: JSON.parse(savedUser) as User });
  } catch {
    return set({ status: 'signedOut' });
  }
  refreshProfile().catch(() => {});
}

/** Lấy hồ sơ mới nhất từ server. Token hết hiệu lực -> đăng xuất; lỗi mạng -> giữ nguyên (ném lỗi cho nơi gọi). */
export async function refreshProfile(): Promise<void> {
  if (!token) return;
  try {
    const { user } = await api.me(token);
    if (!token) return;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ status: 'signedIn', user });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) await clear();
    else throw e;
  }
}

export async function signUp(input: { name: string; email: string; password: string }): Promise<void> {
  const s = await api.register(input);
  await persist(s.token, s.user);
}

export async function signIn(input: { email: string; password: string }): Promise<void> {
  const s = await api.login(input);
  await persist(s.token, s.user);
}

/** Đăng xuất: báo server hủy token (không có mạng cũng vẫn đăng xuất trên máy). Lịch sử trên máy được giữ lại. */
export async function signOut(): Promise<void> {
  const t = token;
  await clear();
  if (t) api.logout(t).catch(() => {});
}

/** Gọi API cần đăng nhập; token hết hiệu lực thì đăng xuất rồi báo lỗi. */
async function authed<T>(fn: (t: string) => Promise<T>): Promise<T> {
  if (!token) throw new ApiError('Cần đăng nhập.', 'UNAUTHENTICATED', 401);
  try {
    return await fn(token);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) await clear();
    throw e;
  }
}

export async function updateProfile(input: { name?: string; email?: string; currentPassword?: string }): Promise<void> {
  const { user } = await authed((t) => api.updateProfile(t, input));
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  set({ status: 'signedIn', user });
}

export async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
  await authed((t) => api.changePassword(t, input));
}

export async function deleteAccount(password: string): Promise<void> {
  await authed((t) => api.deleteAccount(t, password));
  await clear();
}
