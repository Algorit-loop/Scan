import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import type { LayoutResult } from '../layout/LayoutEngine';
import type { ReadingDoc } from '../reading/compose';

/** 'enhanced': bản "Rõ chữ" (khử bóng, nền trắng, chữ đậm); 'original': ảnh nắn phẳng nguyên gốc. */
export type ScanMode = 'enhanced' | 'original';
export type Variant = { uri: string; width: number; height: number };

export type Scan = {
  /** Số thứ tự bản quét trong phiên (ảnh có thể đổi file khi xoay thẳng, id thì không). */
  id: number;
  /** Bản đang xem (theo mode). */
  uri: string;
  width: number;
  height: number;
  /** false: không thấy tài liệu, ảnh là khung hình gốc. */
  flattened: boolean;
  mode: ScanMode;
  /** Có bản "Rõ chữ" để chuyển qua lại không. */
  hasEnhanced: boolean;
  /** Mục lịch sử chứa bản quét này (null: chưa lưu — đang phân tích, hoặc không lưu được). */
  historyId: string | null;
  /** true: mở lại từ lịch sử (ảnh nằm trong thư mục lịch sử, không phải cache). */
  fromHistory: boolean;
};

/** Các bước của dây chuyền sau khi chụp (xem reading/runAnalysis.ts). */
export type AnalysisStep = 'orient' | 'ocr';
export type AnalysisTimings = {
  /** Hướng trang + bố cục (ms, gồm cả chờ nạp model). */
  layout: number;
  /** Xoay ảnh cho thẳng (0 nếu không cần). */
  rotate: number;
  /** Nhận dạng chữ: chờ nạp / giải mã / tiền xử lý / Tesseract. */
  ocrLoad: number;
  ocrDecode: number;
  ocrPre: number;
  ocr: number;
  /** Ghép đoạn + tách câu. */
  compose: number;
  /** Từ lúc bắt đầu tới lúc có nội dung để đọc. */
  total: number;
};
/** Trạng thái phân tích của bản quét hiện tại (màn kết quả theo dõi). Kết quả không phụ thuộc bản đang xem. */
export type AnalysisState =
  | { status: 'pending'; step: AnalysisStep; startedAt: number }
  | {
      status: 'done';
      /** Thời điểm có kết quả (ms) — mỗi lần phân tích xong là một nội dung mới để đọc từ đầu. */
      at: number;
      doc: ReadingDoc;
      /** null: bước hướng trang / bố cục lỗi (vẫn đọc được chữ, coi như trang đã thẳng). */
      layout: Omit<LayoutResult, 'image'> | null;
      /** Kích thước ảnh Tesseract đã đọc. */
      ocrSize: [number, number];
      ms: AnalysisTimings;
    }
  | { status: 'error'; step: AnalysisStep; message: string };

/** Chỉ giữ ảnh vừa chụp (trong cache), ảnh cũ bị xóa khi có ảnh mới. Ảnh của mục lịch sử thì không bao giờ xóa ở đây. */
let variants: Partial<Record<ScanMode, Variant>> = {};
let ownsFiles = true;
let last: Scan | null = null;
let analysis: AnalysisState | null = null;
let nextScanId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function deleteFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // đã bị hệ thống dọn
  }
}

let seq = 0;
async function writeJpeg(base64Jpeg: string): Promise<string> {
  const file = new File(Paths.cache, `scan-${Date.now()}-${seq++}.jpg`);
  await file.write(base64Jpeg, { encoding: 'base64' });
  return file.uri;
}

/** Lưu ảnh vừa chụp (+ bản "Rõ chữ" nếu có; mặc định xem bản "Rõ chữ"). */
export async function saveScan(
  base64Jpeg: string,
  info: { width: number; height: number; flattened: boolean },
  enhancedBase64?: string,
): Promise<Scan> {
  const size = { width: info.width, height: info.height };
  const next: Partial<Record<ScanMode, Variant>> = { original: { uri: await writeJpeg(base64Jpeg), ...size } };
  if (enhancedBase64) next.enhanced = { uri: await writeJpeg(enhancedBase64), ...size };
  dropCurrentFiles();
  variants = next;
  ownsFiles = true;
  const mode: ScanMode = next.enhanced ? 'enhanced' : 'original';
  last = {
    id: nextScanId++,
    ...next[mode]!,
    flattened: info.flattened,
    mode,
    hasEnhanced: !!next.enhanced,
    historyId: null,
    fromHistory: false,
  };
  analysis = null;
  emit();
  return last;
}

function dropCurrentFiles() {
  if (ownsFiles) for (const v of Object.values(variants)) deleteFile(v.uri);
}

/**
 * Đưa một mục lịch sử lên làm bản quét hiện tại (màn kết quả hiển thị y như vừa quét xong): ảnh trỏ thẳng vào thư mục
 * lịch sử, kết quả phân tích lấy từ file đã lưu.
 */
export function restoreScan(input: {
  historyId: string;
  variants: Partial<Record<ScanMode, Variant>>;
  flattened: boolean;
  analysis: Extract<AnalysisState, { status: 'done' }>;
}): Scan | null {
  const mode: ScanMode = input.variants.enhanced ? 'enhanced' : 'original';
  const shown = input.variants[mode];
  if (!shown) return null;
  dropCurrentFiles();
  variants = input.variants;
  ownsFiles = false;
  last = {
    id: nextScanId++,
    ...shown,
    flattened: input.flattened,
    mode,
    hasEnhanced: !!input.variants.enhanced,
    historyId: input.historyId,
    fromHistory: true,
  };
  analysis = input.analysis;
  emit();
  return last;
}

/** Ghi nhận bản quét `id` đã được lưu thành mục lịch sử `historyId`. */
export function attachHistory(id: number, historyId: string) {
  if (last?.id !== id) return;
  last = { ...last, historyId };
  emit();
}

/** Mọi bản ảnh của bản quét `id` (rỗng nếu đã có bản quét mới hơn). */
export function getVariants(id: number): Partial<Record<ScanMode, Variant>> {
  return last?.id === id ? { ...variants } : {};
}

/** Chuyển bản đang xem. Hai bản cùng hình học nên kết quả phân tích (chữ, khung) giữ nguyên. */
export function setScanMode(mode: ScanMode) {
  const v = variants[mode];
  if (!last || !v || last.mode === mode) return;
  last = { ...last, ...v, mode };
  emit();
}

/** Một bản của bản quét `id` (null nếu đã có bản quét mới hơn hoặc không có bản đó). */
export function getVariant(id: number, mode: ScanMode): Variant | null {
  return last?.id === id ? (variants[mode] ?? null) : null;
}

/**
 * Thay ảnh của các bản thuộc bản quét `id` (vd. sau khi xoay thẳng); file cũ bị xóa.
 * Trả false nếu đã có bản quét mới hơn (file mới bị xóa luôn).
 */
export function replaceVariants(id: number, next: Partial<Record<ScanMode, Variant>>): boolean {
  if (last?.id !== id) {
    for (const v of Object.values(next)) deleteFile(v.uri);
    return false;
  }
  for (const mode of Object.keys(next) as ScanMode[]) {
    const old = variants[mode];
    if (ownsFiles && old && old.uri !== next[mode]!.uri) deleteFile(old.uri);
    variants[mode] = next[mode];
  }
  last = { ...last, ...variants[last.mode]! };
  emit();
  return true;
}

export function getLastScan(): Scan | null {
  return last;
}

/** Cập nhật trạng thái phân tích của bản quét `id`; bỏ qua nếu đã có bản quét mới hơn. */
export function setAnalysis(id: number, state: AnalysisState) {
  if (last?.id !== id) return;
  analysis = state;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useLastScan(): Scan | null {
  return useSyncExternalStore(subscribe, () => last);
}

export function useAnalysis(): AnalysisState | null {
  return useSyncExternalStore(subscribe, () => analysis);
}
