import { useSyncExternalStore } from 'react';

/**
 * Trạng thái nạp của từng phần chạy trong WebView ẩn:
 *  ori = model hướng trang, S = model bố cục PP-DocLayout-S (cùng một engine), ocr = bộ nhận dạng chữ (Tesseract).
 */
export type EngineState = 'downloading' | 'loading' | 'ready' | 'error';
export type EngineName = 'ori' | 'S' | 'ocr';
export type EngineStatus = Record<EngineName, { state: EngineState; message?: string; ms?: number }>;

let status: EngineStatus = {
  ori: { state: 'downloading' },
  S: { state: 'downloading' },
  ocr: { state: 'downloading' },
};
const listeners = new Set<() => void>();

export function setEngineStatus(names: EngineName[], value: EngineStatus[EngineName]) {
  const next = { ...status };
  for (const n of names) next[n] = value;
  status = next;
  // Hiện trong terminal Expo: dấu vết để biết engine dừng ở bước nào trên máy thật.
  console.log(`[engine] ${names.join(',')}: ${value.state}${value.ms ? ` (${Math.round(value.ms)} ms)` : ''}${value.message ? ` — ${value.message}` : ''}`);
  for (const l of listeners) l();
}

export function getEngineStatus(): EngineStatus {
  return status;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** Mô tả ngắn trạng thái của một nhóm phần (vd. ['ori', 'S'] cho bộ hướng trang + bố cục). */
export function describe(s: EngineStatus, names: EngineName[]): string {
  const parts = names.map((n) => s[n]);
  const err = parts.find((p) => p.state === 'error');
  if (err) return `lỗi: ${err.message ?? 'không rõ'}`;
  if (parts.some((p) => p.state === 'downloading')) return 'đang tải…';
  if (parts.some((p) => p.state === 'loading')) return 'đang nạp…';
  return 'sẵn sàng';
}

export function allReady(s: EngineStatus, names: EngineName[]): boolean {
  return names.every((n) => s[n].state === 'ready');
}
