import Constants from 'expo-constants';

import type { DetectionResult, NormPoint } from '../detection/types';

export const SERVER_PORT = 8000;
const RECONNECT_MS = 3000;
const DETECT_TIMEOUT_MS = 1500;
const WARP_TIMEOUT_MS = 15000;

/**
 * Server chạy trên cùng máy với Metro (npx expo start), nên lấy host từ địa chỉ Metro
 * mà Expo Go đang kết nối, ví dụ "192.168.1.5:8081" -> "192.168.1.5".
 */
export function getServerHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  return hostUri.split(':')[0] || null;
}

export type ServerStatus = 'connecting' | 'online' | 'offline';

export type ServerDetection = {
  result: DetectionResult;
  /** Thời gian xử lý trên server (ms). */
  serverMs: number;
  /** Thời gian khứ hồi app -> server -> app (ms), gồm cả serverMs. */
  rttMs: number;
};

type Pending = {
  resolve: (d: ServerDetection) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  sentAt: number;
};

export class ServerClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  status: ServerStatus = 'connecting';

  constructor(
    private readonly host: string,
    private readonly onStatus: (s: ServerStatus) => void,
  ) {}

  get httpBase() {
    return `http://${this.host}:${SERVER_PORT}`;
  }

  connect() {
    if (this.closed) return;
    this.setStatus('connecting');
    const ws = new WebSocket(`ws://${this.host}:${SERVER_PORT}/ws`);
    this.ws = ws;
    ws.onopen = () => this.setStatus('online');
    ws.onmessage = (e) => this.handleMessage(String(e.data));
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failAll(new Error('Mất kết nối server'));
      this.setStatus('offline');
      if (!this.closed) this.retryTimer = setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.failAll(new Error('Đã đóng'));
    this.ws?.close();
    this.ws = null;
  }

  detect(imageB64: string): Promise<ServerDetection> {
    const ws = this.ws;
    if (!ws || this.status !== 'online') return Promise.reject(new Error('Server chưa sẵn sàng'));
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error('Server trả lời quá chậm'));
      }, DETECT_TIMEOUT_MS);
      this.pending.set(seq, { resolve, reject, timer, sentAt: performance.now() });
      ws.send(JSON.stringify({ seq, image: imageB64 }));
    });
  }

  /** Nắn phẳng ảnh độ phân giải cao theo 4 góc. Trả về JPEG base64. */
  async warp(imageB64: string, corners: NormPoint[]): Promise<{ image: string; width: number; height: number }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WARP_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.httpBase}/warp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageB64, corners }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`warp lỗi ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private handleMessage(text: string) {
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    const p = this.pending.get(msg.seq);
    if (!p) return; // kết quả đến muộn sau timeout — bỏ
    this.pending.delete(msg.seq);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new Error(msg.error));
      return;
    }
    const t = msg.timings ?? {};
    p.resolve({
      result: msg.result as DetectionResult,
      serverMs: (t.decode ?? 0) + (t.detect ?? 0),
      rttMs: performance.now() - p.sentAt,
    });
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private setStatus(s: ServerStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }
}
