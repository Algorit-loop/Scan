/** Cổng mặc định của server (Server/src/config.mjs). */
export const SERVER_PORT = 4000;

/** Chuẩn hóa địa chỉ người dùng nhập: thêm http:// và cổng mặc định nếu thiếu; null nếu không hợp lệ. */
export function normalizeServerUrl(input: string): string | null {
  let v = input.trim().replace(/\/+$/, '');
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  const m = /^(https?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(:\d{1,5})?$/i.exec(v);
  if (!m) return null;
  // http không ghi cổng -> cổng mặc định của server; https thì giữ nguyên (443).
  return `${m[1].toLowerCase()}://${m[2]}${m[3] ?? (m[1].toLowerCase() === 'http' ? `:${SERVER_PORT}` : '')}`;
}
