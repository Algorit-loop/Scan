import type { ReadingDoc } from '../reading/compose';

/** Thông tin tóm tắt của một mục lịch sử (nằm trong index.json; nội dung đầy đủ ở file riêng). */
export type HistoryItem = {
  /** Tên thư mục của mục: thời điểm quét + hậu tố ngẫu nhiên. */
  id: string;
  createdAt: number;
  /** Lần cuối mở / đọc. */
  updatedAt: number;
  /** Tiêu đề hiển thị: câu đầu tiên của tài liệu (rút gọn). */
  title: string;
  /** Số câu của tài liệu. */
  sentences: number;
  /** Câu đang đọc dở (chỉ số từ 0; -1: chưa đọc câu nào). */
  checkpoint: number;
  width: number;
  height: number;
  /** false: lúc quét không thấy trang giấy, ảnh là khung hình gốc. */
  flattened: boolean;
  hasEnhanced: boolean;
  /** Độ tin cậy nhận dạng trung bình (0..100). */
  conf: number;
};

const TITLE_MAX = 80;

/** Tiêu đề cho mục lịch sử: câu đầu (nối thêm câu sau nếu câu đầu quá ngắn), cắt ở ranh giới từ. */
export function makeTitle(doc: Pick<ReadingDoc, 'sentences'>): string {
  let title = '';
  for (const s of doc.sentences) {
    title = title ? `${title} ${s.text}` : s.text;
    if (title.length >= 24) break;
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return 'Tài liệu không có chữ';
  if (title.length <= TITLE_MAX) return title;
  const cut = title.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_MAX * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/u, '')}…`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Thời điểm quét, dạng dễ nghe: "Hôm nay 14:05", "Hôm qua 09:30", "24/11/2026 14:05". */
export function formatWhen(time: number, now: number = Date.now()): string {
  const d = new Date(time);
  const clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const dayStart = (t: number) => {
    const x = new Date(t);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  const days = Math.round((dayStart(now) - dayStart(time)) / 86400000);
  if (days === 0) return `Hôm nay ${clock}`;
  if (days === 1) return `Hôm qua ${clock}`;
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${clock}`;
}

/** Tiến độ đọc: "Chưa đọc · 12 câu", "Đang đọc câu 5 / 12", "Đã đọc hết · 12 câu". */
export function progressLabel(item: Pick<HistoryItem, 'checkpoint' | 'sentences'>): string {
  if (item.sentences <= 0) return 'Không có chữ';
  if (item.checkpoint < 0) return `Chưa đọc · ${item.sentences} câu`;
  if (item.checkpoint >= item.sentences - 1) return `Đã đọc tới câu cuối · ${item.sentences} câu`;
  return `Đang đọc câu ${item.checkpoint + 1} / ${item.sentences}`;
}

/** Giữ chỉ số câu trong phạm vi tài liệu. */
export function clampCheckpoint(index: number, sentences: number): number {
  if (!Number.isFinite(index) || sentences <= 0) return -1;
  return Math.max(-1, Math.min(sentences - 1, Math.floor(index)));
}
