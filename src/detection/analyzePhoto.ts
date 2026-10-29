import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';

import { detectDocument, rgbaToGray } from './detectDocument';
import type { DetectionResult } from './types';

/** Chiều rộng ảnh dùng để phân tích — đủ nhỏ để xử lý nhanh bằng JS. */
export const ANALYSIS_WIDTH = 160;

/** Thời gian (ms) của từng bước — để đo hiệu năng trên máy thật. */
export type AnalysisTimings = {
  resize: number;
  read: number;
  decode: number;
  detect: number;
};

export type Analysis = {
  result: DetectionResult;
  /** Kích thước ảnh gốc (dùng để vẽ khung và crop khi chụp thật). */
  photoWidth: number;
  photoHeight: number;
  timings: AnalysisTimings;
};

function safeDelete(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // File tạm trong cache — xóa hụt cũng không sao.
  }
}

/**
 * Thu nhỏ ảnh camera, decode ra pixel rồi chạy detectDocument.
 * Xóa ảnh gốc và ảnh thu nhỏ sau khi xong để cache không phình to.
 */
export async function analyzePhoto(
  uri: string,
  photoWidth: number,
  photoHeight: number,
): Promise<Analysis> {
  const ctx = ImageManipulator.manipulate(uri, { maxWidth: ANALYSIS_WIDTH * 2 });
  let smallUri: string | null = null;
  try {
    let t = performance.now();
    const ref = await ctx.resize({ width: ANALYSIS_WIDTH }).renderAsync();
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    ref.release();
    smallUri = saved.uri;
    const resize = performance.now() - t;

    t = performance.now();
    const bytes = await new File(saved.uri).bytes();
    const read = performance.now() - t;

    t = performance.now();
    const raw = decode(bytes, { useTArray: true, formatAsRGBA: true });
    const gray = rgbaToGray(raw.data, raw.width, raw.height);
    const decodeMs = performance.now() - t;

    t = performance.now();
    const result = detectDocument(gray);
    const detect = performance.now() - t;

    return { result, photoWidth, photoHeight, timings: { resize, read, decode: decodeMs, detect } };
  } finally {
    ctx.release();
    safeDelete(uri);
    if (smallUri) safeDelete(smallUri);
  }
}
