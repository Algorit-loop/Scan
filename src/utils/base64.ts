const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(256);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;
// Biến thể URL-safe
LOOKUP['-'.charCodeAt(0)] = 62;
LOOKUP['_'.charCodeAt(0)] = 63;

/** Bỏ tiền tố "data:image/jpeg;base64," nếu có. */
export function stripDataUrl(b64: string): string {
  const i = b64.indexOf(',');
  return b64.startsWith('data:') && i >= 0 ? b64.slice(i + 1) : b64;
}

/** base64 -> bytes. Tự cài đặt để không phụ thuộc atob/Buffer của engine JS. */
export function base64ToBytes(input: string): Uint8Array {
  const b64 = stripDataUrl(input).replace(/[\s=]+/g, '');
  const len = b64.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 4 <= len; i += 4) {
    const n =
      (LOOKUP[b64.charCodeAt(i)] << 18) |
      (LOOKUP[b64.charCodeAt(i + 1)] << 12) |
      (LOOKUP[b64.charCodeAt(i + 2)] << 6) |
      LOOKUP[b64.charCodeAt(i + 3)];
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest === 2) {
    const n = (LOOKUP[b64.charCodeAt(i)] << 18) | (LOOKUP[b64.charCodeAt(i + 1)] << 12);
    out[o++] = (n >> 16) & 255;
  } else if (rest === 3) {
    const n =
      (LOOKUP[b64.charCodeAt(i)] << 18) |
      (LOOKUP[b64.charCodeAt(i + 1)] << 12) |
      (LOOKUP[b64.charCodeAt(i + 2)] << 6);
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
  }
  return out.subarray(0, o);
}
