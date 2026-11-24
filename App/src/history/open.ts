import { restoreScan, type ScanMode, type Variant } from '../scanner/lastScan';
import { getHistoryItem, itemImage, readHistoryContent } from './store';

/**
 * Mở một mục lịch sử: nạp nội dung đã lưu và đưa lên làm "bản quét hiện tại" để màn kết quả hiển thị y như vừa quét
 * xong (không chạy lại nhận dạng). Câu đang đọc dở lấy từ mục lịch sử (màn kết quả đọc tiếp từ đó).
 * Trả false nếu mục không còn / file hỏng.
 */
export async function openHistoryItem(id: string): Promise<boolean> {
  const item = getHistoryItem(id);
  if (!item) return false;
  const content = await readHistoryContent(id);
  if (!content) return false;
  const size = { width: item.width, height: item.height };
  const variants: Partial<Record<ScanMode, Variant>> = { original: { uri: itemImage(id, 'original'), ...size } };
  if (item.hasEnhanced) variants.enhanced = { uri: itemImage(id, 'enhanced'), ...size };
  return !!restoreScan({
    historyId: id,
    variants,
    flattened: item.flattened,
    analysis: { status: 'done', at: Date.now(), ...content },
  });
}
