import { composeDocument, endsSentence, filterLines, joinWords, type OcrLine, speakable } from '../reading/compose';

/**
 * Dựng kết quả OCR giả: mỗi phần tử là một dòng chữ; `block` / `par` như Tesseract; dòng cách nhau `lineGap` px.
 * Mỗi ký tự rộng 10 px, dòng cao `h` px.
 */
function ocr(rows: { text: string; block?: number; par?: number; top?: number; h?: number; left?: number; conf?: number }[]): OcrLine[] {
  let y = 0;
  return rows.map((r, i) => {
    const h = r.h ?? 20;
    const top = r.top ?? y;
    y = top + h + 6;
    let x = r.left ?? 0;
    const words = r.text.split(' ').map((text) => {
      const box: [number, number, number, number] = [x, top, x + text.length * 10, top + h];
      x += text.length * 10 + 10;
      return { text, conf: r.conf ?? 92, box };
    });
    return { block: r.block ?? 1, par: r.par ?? 1, line: i, box: [r.left ?? 0, top, x - 10, top + h], words };
  });
}

const texts = (lines: OcrLine[]) => composeDocument(lines, 1000, 1400).sentences.map((s) => s.text);

describe('endsSentence', () => {
  it('dấu . ! ? … kết câu khi chữ sau viết hoa hoặc hết đoạn', () => {
    expect(endsSentence('nhà.', 'Sau')).toBe(true);
    expect(endsSentence('không?', 'Có')).toBe(true);
    expect(endsSentence('quá!', null)).toBe(true);
    expect(endsSentence('vui”.', 'Hôm')).toBe(true);
    expect(endsSentence('khác”,', 'ông')).toBe(false);
    expect(endsSentence('nhà', 'Sau')).toBe(false);
  });

  it('chữ sau viết thường thì dấu chấm không kết câu', () => {
    expect(endsSentence('vv.', 'và')).toBe(false);
    expect(endsSentence('rồi...', 'mới')).toBe(false);
    expect(endsSentence('rồi…', 'Mai')).toBe(true);
  });

  it('viết tắt, danh xưng, tên viết tắt không kết câu', () => {
    expect(endsSentence('TP.', 'Hồ')).toBe(false);
    expect(endsSentence('Tp.', 'Huế')).toBe(false);
    expect(endsSentence('ThS.', 'Nguyễn')).toBe(false);
    expect(endsSentence('PGS.', 'TS.')).toBe(false);
    expect(endsSentence('Q.', '1')).toBe(false);
    expect(endsSentence('V.', 'An', 3, false, 'Nguyễn')).toBe(false);
    expect(endsSentence('I.', 'Buổi', 9, false, 'kỳ')).toBe(true);
    expect(endsSentence('B.', 'Sau', 4, false, 'án')).toBe(true);
    expect(endsSentence('v.v.', 'và')).toBe(false);
    expect(endsSentence('v.v.', 'Ngoài')).toBe(true);
  });

  it('số thứ tự đầu mục không kết câu, nhưng số ở cuối câu thì có', () => {
    expect(endsSentence('1.', 'Mở', 0, true)).toBe(false);
    expect(endsSentence('a.', 'Nội', 0, true)).toBe(false);
    expect(endsSentence('IV.', 'Kết', 0, true)).toBe(false);
    expect(endsSentence('2027.', 'Sau', 5, false)).toBe(true);
    expect(endsSentence('10.', 'Giáo', 7, false)).toBe(true);
  });
});

describe('joinWords', () => {
  it('sửa khoảng trắng quanh dấu câu và nối từ ngắt dòng bằng gạch nối', () => {
    expect(joinWords(['Xin', 'chào', ',', 'bạn', '!'])).toBe('Xin chào, bạn!');
    expect(joinWords(['mỗi', 'héc-', 'ta', '(', 'ước', 'tính', ')'])).toBe('mỗi héc-ta (ước tính)');
    expect(joinWords(['2026', '-', '2027'])).toBe('2026 - 2027');
  });
});

describe('filterLines', () => {
  it('bỏ từ / dòng tin cậy thấp và dòng không có chữ', () => {
    const lines = ocr([
      { text: 'Dòng chữ thật' },
      { text: '|| ~ __', conf: 80 },
      { text: 'rác lẫn vào', conf: 20 },
      { text: 'xyz qwe', conf: 40 },
    ]);
    lines[0].words.push({ text: '§', conf: 12, box: [200, 0, 210, 20] });
    const kept = filterLines(lines);
    expect(kept).toHaveLength(1);
    expect(kept[0].words.map((w) => w.text)).toEqual(['Dòng', 'chữ', 'thật']);
  });
});

describe('composeDocument', () => {
  it('ghép dòng thành đoạn và tách câu theo dấu chấm', () => {
    const doc = composeDocument(
      ocr([
        { text: 'Sốt là phản ứng tự nhiên của cơ thể. Khi trẻ sốt từ 38,5 độ C' },
        { text: 'trở lên, cha mẹ có thể cho trẻ uống thuốc. Liều dùng là 10 đến' },
        { text: '15 mg cho mỗi kg cân nặng.' },
      ]),
      1000,
      1400,
    );
    expect(doc.sentences.map((s) => s.text)).toEqual([
      'Sốt là phản ứng tự nhiên của cơ thể.',
      'Khi trẻ sốt từ 38,5 độ C trở lên, cha mẹ có thể cho trẻ uống thuốc.',
      'Liều dùng là 10 đến 15 mg cho mỗi kg cân nặng.',
    ]);
    expect(doc.paragraphs).toHaveLength(1);
    // Câu thứ hai vắt qua 2 dòng -> 2 khung để tô sáng.
    expect(doc.sentences[1].boxes).toHaveLength(2);
    expect(doc.sentences.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('tiêu đề (không có dấu kết câu, chữ to) là một câu riêng, không dính vào thân bài', () => {
    const out = texts(
      ocr([
        { text: 'THÔNG BÁO', par: 1, h: 40 },
        { text: 'Về việc tổ chức họp phụ huynh', par: 2, h: 26 },
        { text: 'Kính gửi: Quý phụ huynh học sinh khối lớp 9.', par: 3, top: 140 },
      ]),
    );
    expect(out).toEqual(['THÔNG BÁO', 'Về việc tổ chức họp phụ huynh', 'Kính gửi: Quý phụ huynh học sinh khối lớp 9.']);
  });

  it('nối các đoạn Tesseract tách nhầm khi câu chưa hết và dòng sát nhau', () => {
    const out = texts(
      ocr([
        { text: 'Năm nay thời tiết thuận lợi, năng suất ước đạt gần', par: 1 },
        { text: '5 tấn mỗi héc-ta, cao hơn năm ngoái khoảng 8%.', par: 2 },
      ]),
    );
    expect(out).toEqual(['Năm nay thời tiết thuận lợi, năng suất ước đạt gần 5 tấn mỗi héc-ta, cao hơn năm ngoái khoảng 8%.']);
  });

  it('dòng cuối ngắn bị tách sang khối khác vẫn nối lại (chữ thường, ngay dưới, cùng lề)', () => {
    const out = texts(
      ocr([
        { text: 'quan, chụp ảnh và trải nghiệm gặt lúa cùng người', block: 1, h: 26 },
        { text: 'dân.', block: 2, h: 18 },
      ]),
    );
    expect(out).toEqual(['quan, chụp ảnh và trải nghiệm gặt lúa cùng người dân.']);
  });

  it('không nối sang cột khác hoặc khi cách đoạn', () => {
    const cols = texts(
      ocr([
        { text: 'Cột trái chưa hết câu', block: 1, top: 600, left: 0 },
        { text: 'cột phải là chuyện khác.', block: 2, top: 100, left: 520 },
      ]),
    );
    expect(cols).toHaveLength(2);
    const gap = texts(
      ocr([
        { text: 'Đề mục thứ nhất', par: 1, top: 0 },
        { text: 'Nội dung nằm cách xa bên dưới.', par: 2, top: 80 },
      ]),
    );
    expect(gap).toHaveLength(2);
  });

  it('giữ nguyên số thập phân, ngày tháng, số điện thoại, viết tắt trong câu', () => {
    const out = texts(
      ocr([
        { text: 'Liên hệ ThS. Nguyễn V. An tại TP. Hồ Chí Minh trước ngày 15/01/2027 qua số 028.3812.4567. Xin cảm ơn!' },
      ]),
    );
    expect(out).toEqual(['Liên hệ ThS. Nguyễn V. An tại TP. Hồ Chí Minh trước ngày 15/01/2027 qua số 028.3812.4567.', 'Xin cảm ơn!']);
  });

  it('đầu mục đánh số đi cùng nội dung của nó', () => {
    const out = texts(
      ocr([
        { text: '1. Thông báo kết quả học tập.', par: 1 },
        { text: '2. Trao đổi kế hoạch ôn thi.', par: 2 },
        { text: 'a. Thống nhất các khoản thu.', par: 3 },
      ]),
    );
    expect(out).toEqual(['1. Thông báo kết quả học tập.', '2. Trao đổi kế hoạch ôn thi.', 'a. Thống nhất các khoản thu.']);
  });

  it('câu quá dài được chia ở dấu chấm phẩy / phẩy gần giữa, không tạo mẩu quá ngắn', () => {
    const clause = 'nhà trường đề nghị quý phụ huynh sắp xếp thời gian đến đúng giờ và mang theo giấy mời';
    const long = `Để buổi họp đạt kết quả tốt, ${clause}; ${clause}; ${clause}, ${clause}.`;
    const doc = composeDocument(ocr([{ text: long }]), 5000, 1400);
    expect(doc.sentences.length).toBeGreaterThan(1);
    for (const s of doc.sentences) {
      expect(s.text.length).toBeLessThanOrEqual(260);
      expect(s.text.length).toBeGreaterThanOrEqual(60);
    }
    expect(doc.sentences.map((s) => s.text).join(' ')).toBe(long);
  });

  it('ảnh không có chữ -> tài liệu rỗng', () => {
    const doc = composeDocument([], 100, 100);
    expect(doc.sentences).toEqual([]);
    expect(doc.paragraphs).toEqual([]);
  });
});

describe('speakable', () => {
  it('bỏ ký hiệu đầu dòng và đổi ký hiệu khó đọc', () => {
    expect(speakable('• Mang theo giấy mời')).toBe('Mang theo giấy mời');
    expect(speakable('- Năm học 2026 – 2027')).toBe('Năm học 2026, 2027');
    expect(speakable('“Đất ở đây khó lắm…”')).toBe('"Đất ở đây khó lắm..."');
  });
});

// Kết quả OCR thật (Tesseract trên trang thử, ghi bằng `node scripts/check-ocr.mjs --json`): kiểm tra cả dây chuyền
// lọc -> ghép đoạn -> tách câu trên dữ liệu có lỗi OCR, dòng bị tách khối, trang hai cột.
describe('composeDocument trên kết quả OCR thật', () => {
  const load = (name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = require(`./fixtures/${name}.ocr.json`);
    return composeDocument(f.lines, f.width, f.height);
  };

  it('thông báo một cột: tiêu đề, trích yếu, 5 đoạn -> 10 câu', () => {
    const s = load('thongbao_1350').sentences.map((x) => x.text);
    expect(s).toHaveLength(10);
    expect(s[0]).toBe('THÔNG BÁO');
    expect(s[1]).toMatch(/^Về việc tổ chức họp phụ huynh .* 2026 . 2027$/);
    expect(s[3]).toMatch(/cuối học kỳ I\.$/); // "I." là số La Mã cuối câu, không phải tên viết tắt
    expect(s[4]).toMatch(/^Buổi họp sẽ diễn ra/);
    expect(s[8]).toMatch(/15\/01\/2027 qua số điện thoại [\d.§]+$/); // ngày tháng + số điện thoại không bị cắt
    expect(s[9]).toBe('Trân trọng cảm ơn sự quan tâm và phối hợp của quý phụ huynh!');
  });

  it('bài báo hai cột: đọc hết cột trái rồi sang cột phải, dòng cuối ngắn không tách rời -> 12 câu', () => {
    const doc = load('baochi_1350');
    const s = doc.sentences.map((x) => x.text);
    expect(s).toHaveLength(12);
    expect(s[0]).toBe('Mùa gặt trên những thửa ruộng bậc thang');
    expect(s[5]).toMatch(/^“Đất ở đây khó lắm.*ông nói\.$/);
    expect(s[7]).toMatch(/cùng người dân\.$/);
    expect(s[8]).toMatch(/^Chính quyền xã cho biết/); // câu đầu cột phải
    expect(s[11]).toMatch(/tràn đầy niềm vui\.$/);
    // Câu ở cột phải có khung nằm bên phải nửa trang.
    expect(doc.sentences[8].boxes[0][0]).toBeGreaterThan(doc.width / 2);
  });

  it('hướng dẫn dùng thuốc: số thập phân và đơn vị không làm tách câu -> 10 câu', () => {
    const s = load('suckhoe_1000').sentences.map((x) => x.text);
    expect(s).toHaveLength(10);
    expect(s[2]).toMatch(/^Khi trẻ sốt từ 38,5 độ C trở lên.*bác sĩ\.$/);
    expect(s[5]).toBe('Ví dụ: trẻ nặng 12 kg thì mỗi lần uống từ 120 mg đến 180 mg.');
  });
});
