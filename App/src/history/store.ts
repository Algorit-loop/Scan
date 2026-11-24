import { Directory, File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import type { LayoutResult } from '../layout/LayoutEngine';
import type { ReadingDoc } from '../reading/compose';
import type { AnalysisTimings, ScanMode, Variant } from '../scanner/lastScan';
import { clampCheckpoint, type HistoryItem, makeTitle } from './summary';

/**
 * Lịch sử quét — lưu HOÀN TOÀN trên điện thoại (thư mục tài liệu của app), không gửi lên server:
 *
 *   <document>/history/<id người dùng>/index.json          danh sách mục (tóm tắt + câu đang đọc dở), mới nhất trước
 *   <document>/history/<id người dùng>/<id mục>/original.jpg, enhanced.jpg, doc.json (nội dung + khung + thời gian)
 *
 * Mỗi tài khoản một thư mục: đăng xuất / đổi tài khoản trên cùng máy không lẫn lịch sử của nhau.
 * Trong index chỉ lưu id (không lưu đường dẫn tuyệt đối): iOS đổi đường dẫn thư mục app sau mỗi lần cập nhật.
 */

/** Nội dung đầy đủ của một mục (doc.json). */
export type HistoryContent = {
  doc: ReadingDoc;
  layout: Omit<LayoutResult, 'image'> | null;
  ocrSize: [number, number];
  ms: AnalysisTimings;
};

const MAX_ITEMS = 100;
const SAVE_DELAY_MS = 600;

let userId: string | null = null;
let items: HistoryItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function userDir(): Directory {
  return new Directory(Paths.document, 'history', userId ?? 'local');
}

const itemDir = (id: string) => new Directory(userDir(), id);
const indexFile = () => new File(userDir(), 'index.json');

/** Đường dẫn ảnh của một mục. */
export function itemImage(id: string, mode: ScanMode): string {
  return new File(itemDir(id), `${mode}.jpg`).uri;
}

function writeIndexNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    userDir().create({ intermediates: true, idempotent: true });
    indexFile().write(JSON.stringify(items));
  } catch (e) {
    console.log(`[lịch sử] không ghi được danh sách: ${(e as Error).message}`);
  }
}

function writeIndexSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeIndexNow, SAVE_DELAY_MS);
}

function removeFiles(id: string) {
  try {
    const dir = itemDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // đã bị xóa
  }
}

/** Nạp lịch sử của người dùng `id` (null: chưa đăng nhập -> danh sách rỗng). Gọi khi trạng thái đăng nhập đổi. */
export async function loadHistory(id: string | null): Promise<void> {
  if (saveTimer) writeIndexNow(); // ghi nốt thay đổi đang chờ của người dùng trước
  userId = id;
  items = [];
  loaded = false;
  emit();
  if (id) {
    try {
      const file = indexFile();
      if (file.exists) {
        const data = JSON.parse(await file.text());
        if (Array.isArray(data)) items = data.filter((x) => x && typeof x.id === 'string');
      }
    } catch (e) {
      console.log(`[lịch sử] không đọc được danh sách: ${(e as Error).message}`);
    }
  }
  if (userId !== id) return; // đã đổi người dùng trong lúc đọc
  loaded = true;
  emit();
}

/**
 * Lưu một bản quét vừa phân tích xong vào lịch sử (chép ảnh từ cache sang thư mục tài liệu). Trả id mục, hoặc null
 * nếu không lưu được.
 */
export async function addToHistory(input: {
  variants: Partial<Record<ScanMode, Variant>>;
  flattened: boolean;
  content: HistoryContent;
}): Promise<string | null> {
  const original = input.variants.original;
  if (!userId || !original) return null;
  const now = Date.now();
  const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const dir = itemDir(id);
    dir.create({ intermediates: true, idempotent: true });
    for (const mode of ['original', 'enhanced'] as ScanMode[]) {
      const v = input.variants[mode];
      if (v) await new File(v.uri).copy(new File(dir, `${mode}.jpg`));
    }
    new File(dir, 'doc.json').write(JSON.stringify(input.content));
  } catch (e) {
    console.log(`[lịch sử] không lưu được bản quét: ${(e as Error).message}`);
    removeFiles(id);
    return null;
  }
  const item: HistoryItem = {
    id,
    createdAt: now,
    updatedAt: now,
    title: makeTitle(input.content.doc),
    sentences: input.content.doc.sentences.length,
    checkpoint: -1,
    width: original.width,
    height: original.height,
    flattened: input.flattened,
    hasEnhanced: !!input.variants.enhanced,
    conf: input.content.doc.conf,
  };
  const next = [item, ...items];
  for (const old of next.splice(MAX_ITEMS)) removeFiles(old.id); // quá giới hạn: bỏ mục cũ nhất
  items = next;
  writeIndexNow();
  emit();
  return id;
}

export function getHistoryItem(id: string): HistoryItem | null {
  return items.find((x) => x.id === id) ?? null;
}

/** Đọc nội dung đầy đủ của một mục (null nếu file hỏng / đã mất). */
export async function readHistoryContent(id: string): Promise<HistoryContent | null> {
  try {
    const data = JSON.parse(await new File(itemDir(id), 'doc.json').text());
    return data && data.doc && Array.isArray(data.doc.sentences) ? (data as HistoryContent) : null;
  } catch (e) {
    console.log(`[lịch sử] không đọc được mục ${id}: ${(e as Error).message}`);
    return null;
  }
}

/** Ghi nhớ câu đang đọc của một mục (ghi file trễ một chút: người dùng có thể bấm chuyển câu liên tục). */
export function setCheckpoint(id: string, index: number) {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const checkpoint = clampCheckpoint(index, items[i].sentences);
  if (items[i].checkpoint === checkpoint) return;
  items = items.map((x, k) => (k === i ? { ...x, checkpoint, updatedAt: Date.now() } : x));
  writeIndexSoon();
  emit();
}

export function removeHistoryItem(id: string) {
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  removeFiles(id);
  writeIndexNow();
  emit();
}

export function clearHistory() {
  for (const x of items) removeFiles(x.id);
  items = [];
  writeIndexNow();
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Danh sách mục (mới nhất trước) + đã nạp xong chưa. */
export function useHistory(): { items: HistoryItem[]; loaded: boolean } {
  const list = useSyncExternalStore(subscribe, () => items);
  const ready = useSyncExternalStore(subscribe, () => loaded);
  return { items: list, loaded: ready };
}
