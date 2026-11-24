import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { analyzeLayout, type LayoutResult } from '../layout/LayoutEngine';
import { recognizeText } from '../ocr/OcrEngine';
import { addToHistory } from '../history/store';
import {
  type AnalysisTimings,
  attachHistory,
  getLastScan,
  getVariant,
  getVariants,
  replaceVariants,
  type ScanMode,
  setAnalysis,
  type Variant,
} from '../scanner/lastScan';
import { composeDocument } from './compose';

/** Mốc thời gian từ lúc chụp xong tới lúc có nội dung để đọc; vượt thì màn kết quả báo. */
export const ANALYSIS_BUDGET_MS = 5000;

let token = 0;

/**
 * Dây chuyền sau khi chụp, chạy hoàn toàn trên máy, cho bản quét hiện tại:
 *
 *   ảnh nắn phẳng (bản gốc)
 *     -> 1. hướng trang + bố cục  (LayoutEngine: PP-LCNet doc_ori + PP-DocLayout-S, onnxruntime-web)
 *     -> 2. xoay thẳng nếu trang bị xoay 90/180/270° (cả bản gốc lẫn bản "Rõ chữ")
 *     -> 3. nhận dạng chữ         (OcrEngine: khử bóng + Tesseract tiếng Việt)
 *     -> 4. ghép đoạn, tách câu   (compose.ts)
 *     -> nội dung để đọc từng câu (màn kết quả + useReader)
 *     -> 5. lưu vào lịch sử trên máy (ảnh + nội dung; câu đang đọc dở được ghi lại sau)
 *
 * Luôn đọc từ bản gốc: bản "Rõ chữ" đã tăng nét / đậm chữ cho mắt người, không phải cho OCR.
 * Bước 1 lỗi thì vẫn đi tiếp (coi như trang đã thẳng): thà đọc được chữ còn hơn dừng hẳn.
 * Lần gọi sau (bản quét mới / bấm thử lại) thay kết quả của lần gọi trước.
 */
export async function runAnalysis(): Promise<void> {
  const scan = getLastScan();
  if (!scan) return;
  const my = ++token;
  const id = scan.id;
  const startedAt = Date.now();
  const stale = () => my !== token || getLastScan()?.id !== id;
  const ms: AnalysisTimings = { layout: 0, rotate: 0, ocrLoad: 0, ocrDecode: 0, ocrPre: 0, ocr: 0, compose: 0, total: 0 };

  // ----- 1 + 2: hướng trang, bố cục, xoay thẳng -----
  setAnalysis(id, { status: 'pending', step: 'orient', startedAt });
  let layout: Omit<LayoutResult, 'image'> | null = null;
  try {
    const original = getVariant(id, 'original');
    if (!original) return;
    console.log(`[đọc] #${id}: hướng trang + bố cục trên ảnh ${original.width}x${original.height}`);
    const t = Date.now();
    const { image: _image, ...result } = await analyzeLayout(original.uri);
    ms.layout = Date.now() - t;
    if (stale()) return;
    layout = result;
    if (result.rotate) {
      const tr = Date.now();
      await rotateVariants(id, result.rotate);
      ms.rotate = Date.now() - tr;
      console.log(`[đọc] #${id}: trang bị xoay, đã xoay ${result.rotate}° (${ms.rotate} ms)`);
    }
  } catch (e) {
    console.log(`[đọc] #${id}: bỏ qua hướng trang / bố cục — ${(e as Error).message}`);
  }
  if (stale()) return;

  // ----- 3 + 4: nhận dạng chữ, ghép đoạn, tách câu -----
  setAnalysis(id, { status: 'pending', step: 'ocr', startedAt });
  try {
    const original = getVariant(id, 'original');
    if (!original) return;
    const ocr = await recognizeText(original.uri);
    if (stale()) return;
    ms.ocrLoad = ocr.ms.load;
    ms.ocrDecode = ocr.ms.decode;
    ms.ocrPre = ocr.ms.pre;
    ms.ocr = ocr.ms.ocr;
    const tc = Date.now();
    const doc = composeDocument(ocr.lines, ocr.width, ocr.height);
    ms.compose = Date.now() - tc;
    ms.total = Date.now() - startedAt;
    console.log(
      `[đọc] #${id} xong: ${doc.sentences.length} câu / ${doc.paragraphs.length} đoạn, tin cậy ${Math.round(doc.conf)}, tổng ${ms.total} ms ` +
        `(hướng+bố cục ${ms.layout} · xoay ${ms.rotate} · chờ nạp OCR ${Math.round(ms.ocrLoad)} · giải mã ${Math.round(ms.ocrDecode)} · ` +
        `tiền xử lý ${Math.round(ms.ocrPre)} · nhận dạng ${Math.round(ms.ocr)} [${ocr.ocrSize.join('x')}] · tách câu ${ms.compose})`,
    );
    setAnalysis(id, { status: 'done', at: Date.now(), doc, layout, ocrSize: ocr.ocrSize, ms });
    // 5. Lưu lịch sử ở nền (không chặn việc đọc). Ảnh không có chữ thì không lưu. Bấm "Thử lại" trên một bản đã lưu
    //    thì không lưu thêm lần nữa.
    if (doc.sentences.length && !scan.fromHistory && !getLastScan()?.historyId) {
      addToHistory({ variants: getVariants(id), flattened: scan.flattened, content: { doc, layout, ocrSize: ocr.ocrSize, ms } }).then(
        (historyId) => historyId && attachHistory(id, historyId),
      );
    }
  } catch (e) {
    console.log(`[đọc] #${id} LỖI nhận dạng chữ: ${(e as Error).message}`);
    if (!stale()) setAnalysis(id, { status: 'error', step: 'ocr', message: (e as Error).message });
  }
}

/** Xoay mọi bản của bản quét `id` thêm `degrees` độ theo chiều kim đồng hồ (hai bản phải cùng hình học). */
async function rotateVariants(id: number, degrees: number): Promise<void> {
  const next: Partial<Record<ScanMode, Variant>> = {};
  for (const mode of ['original', 'enhanced'] as ScanMode[]) {
    const v = getVariant(id, mode);
    if (!v) continue;
    const r = await manipulateAsync(v.uri, [{ rotate: degrees }], { compress: 0.92, format: SaveFormat.JPEG });
    next[mode] = { uri: r.uri, width: r.width, height: r.height };
  }
  replaceVariants(id, next);
}
