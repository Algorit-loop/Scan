import { normalizeServerUrl } from '../auth/url';
import { clampCheckpoint, formatWhen, makeTitle, progressLabel } from '../history/summary';

const doc = (...texts: string[]) => ({
  sentences: texts.map((text, index) => ({ index, paragraph: 0, text, boxes: [], conf: 90 })),
});

describe('makeTitle', () => {
  it('lấy câu đầu; câu đầu quá ngắn thì nối thêm câu sau', () => {
    expect(makeTitle(doc('Hướng dẫn sử dụng thuốc hạ sốt cho trẻ em', 'Sốt là phản ứng tự nhiên.'))).toBe('Hướng dẫn sử dụng thuốc hạ sốt cho trẻ em');
    expect(makeTitle(doc('THÔNG BÁO', 'Về việc tổ chức họp phụ huynh', 'Kính gửi quý phụ huynh.'))).toBe('THÔNG BÁO Về việc tổ chức họp phụ huynh');
  });

  it('cắt tiêu đề dài ở ranh giới từ, thêm dấu ba chấm', () => {
    const long = 'Căn cứ kế hoạch năm học của nhà trường, Ban Giám hiệu trân trọng kính mời quý phụ huynh đến dự buổi họp cuối học kỳ I.';
    const title = makeTitle(doc(long));
    expect(title.length).toBeLessThanOrEqual(81);
    expect(title.endsWith('…')).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    expect(long[title.length - 1]).toBe(' '); // cắt đúng chỗ hết một từ
  });

  it('tài liệu không có chữ', () => {
    expect(makeTitle(doc())).toBe('Tài liệu không có chữ');
  });
});

describe('formatWhen', () => {
  const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
  const now = at(2026, 11, 24, 15, 30);

  it('hôm nay / hôm qua / ngày cụ thể', () => {
    expect(formatWhen(at(2026, 11, 24, 9, 5), now)).toBe('Hôm nay 09:05');
    expect(formatWhen(at(2026, 11, 23, 23, 59), now)).toBe('Hôm qua 23:59');
    expect(formatWhen(at(2026, 11, 22, 8, 0), now)).toBe('22/11/2026 08:00');
    expect(formatWhen(at(2025, 1, 3, 14, 7), now)).toBe('03/01/2025 14:07');
  });

  it('vừa qua nửa đêm: lần quét lúc 23:50 hôm trước là "Hôm qua"', () => {
    expect(formatWhen(at(2026, 11, 23, 23, 50), at(2026, 11, 24, 0, 10))).toBe('Hôm qua 23:50');
  });
});

describe('progressLabel + clampCheckpoint', () => {
  it('mô tả tiến độ đọc', () => {
    expect(progressLabel({ checkpoint: -1, sentences: 12 })).toBe('Chưa đọc · 12 câu');
    expect(progressLabel({ checkpoint: 4, sentences: 12 })).toBe('Đang đọc câu 5 / 12');
    expect(progressLabel({ checkpoint: 11, sentences: 12 })).toBe('Đã đọc tới câu cuối · 12 câu');
    expect(progressLabel({ checkpoint: -1, sentences: 0 })).toBe('Không có chữ');
  });

  it('giữ câu đang đọc trong phạm vi tài liệu', () => {
    expect(clampCheckpoint(5, 12)).toBe(5);
    expect(clampCheckpoint(99, 12)).toBe(11);
    expect(clampCheckpoint(-7, 12)).toBe(-1);
    expect(clampCheckpoint(3.9, 12)).toBe(3);
    expect(clampCheckpoint(Number.NaN, 12)).toBe(-1);
    expect(clampCheckpoint(2, 0)).toBe(-1);
  });
});

describe('normalizeServerUrl', () => {
  it('thêm http:// và cổng mặc định khi thiếu; https giữ nguyên', () => {
    expect(normalizeServerUrl('192.168.1.5')).toBe('http://192.168.1.5:4000');
    expect(normalizeServerUrl(' http://192.168.1.5:4001/ ')).toBe('http://192.168.1.5:4001');
    expect(normalizeServerUrl('HTTPS://api.example.vn')).toBe('https://api.example.vn');
    expect(normalizeServerUrl('may-tinh.local:8080')).toBe('http://may-tinh.local:8080');
  });

  it('địa chỉ không hợp lệ -> null', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('   ')).toBeNull();
    expect(normalizeServerUrl('ftp://abc')).toBeNull();
    expect(normalizeServerUrl('http://a b c')).toBeNull();
    expect(normalizeServerUrl('192.168.1.5/duong-dan')).toBeNull();
  });
});
