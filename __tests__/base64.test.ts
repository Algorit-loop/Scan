import { base64ToBytes, stripDataUrl } from '../src/utils/base64';

// Bộ mã hóa tham chiếu đơn giản (không dùng Buffer để tsc không cần @types/node).
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function enc(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    s += A[(n >> 18) & 63] + A[(n >> 12) & 63];
    s += i + 1 < bytes.length ? A[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? A[n & 63] : '=';
  }
  return s;
}

describe('base64ToBytes', () => {
  it.each([[[]], [[0]], [[1, 2]], [[1, 2, 3]], [[255, 254, 253, 0, 128]]])('khớp với Buffer: %j', (bytes) => {
    expect(Array.from(base64ToBytes(enc(bytes)))).toEqual(bytes);
  });

  it('dữ liệu ngẫu nhiên dài', () => {
    const bytes = Array.from({ length: 1000 }, (_, i) => (i * 37 + 11) & 255);
    expect(Array.from(base64ToBytes(enc(bytes)))).toEqual(bytes);
  });

  it('chấp nhận tiền tố data URL', () => {
    const b64 = `data:image/jpeg;base64,${enc([255, 216, 255])}`;
    expect(stripDataUrl(b64)).toBe(enc([255, 216, 255]));
    expect(Array.from(base64ToBytes(b64))).toEqual([255, 216, 255]);
  });
});
