import { Paths } from 'expo-file-system';
import { type ComponentType, type RefAttributes, useCallback, useEffect, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import wasmAsset from '../../assets/layout/ort-wasm-simd-threaded.wasm';
import sAsset from '../../assets/layout/pp_doclayout_s.onnx';
import oriAsset from '../../assets/layout/pp_lcnet_doc_ori.onnx';
import { deferred, engineStyles, writeEnginePage } from '../engine/enginePage';
import { LAYOUT_HTML } from './layout.generated';
import { type EngineName, setEngineStatus } from './status';

// Xem ScannerView.tsx: react-native-webview 14.0.1 khai báo kiểu sai, ép lại cho đúng.
type WebViewInstance = WebView<object>;
const TypedWebView = WebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewInstance>>;

/**
 * Model bố cục: PP-DocLayout-S (PicoDet, 23 lớp, ~0,15 s trên điện thoại).
 * PP-DocLayout-L / plus-L (RT-DETR) chính xác hơn nhưng đã bỏ: trên iPhone (iOS 18, WKWebView + onnxruntime-web) bước
 * suy luận của chúng không bao giờ xong (> 120 s) dù bản uint8 hay fp32 — xem README.
 */
export type LayoutModel = 'S';
export const LAYOUT_MODELS: Record<LayoutModel, { name: string }> = { S: { name: 'PP-DocLayout-S' } };

/** Một vùng bố cục; norm = [x1, y1, x2, y2] chuẩn hóa 0..1 theo ảnh (đã xoay thẳng); index = thứ tự đọc. */
export type LayoutRegion = { index: number; cls: number; label: string; score: number; norm: [number, number, number, number] };
export type LayoutResult = {
  model: LayoutModel;
  /** Kích thước ảnh đã đưa vào model (sau khi xoay thẳng). */
  width: number;
  height: number;
  /** Số độ cần xoay thêm theo chiều kim đồng hồ để dựng thẳng trang (0 nếu trang đã thẳng). */
  rotate: number;
  orientation: { angle: number; score: number };
  /** JPEG base64 đã xoay — không dùng nữa (app tự xoay file bằng expo-image-manipulator), luôn vắng. */
  image?: string;
  regions: LayoutRegion[];
  /** ms: load = chờ model nạp xong, decode, orient (hướng trang + xoay), pre, infer, post, total (trừ load). */
  ms: { load: number; decode: number; orient: number; pre: number; infer: number; post: number; total: number };
};
type Pending = { resolve: (r: LayoutResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const ALL: EngineName[] = ['ori', 'S'];

// ---------- Cầu nối tới engine đang mount (một engine cho cả app) ----------

let analyzeImpl: ((uri: string, timeoutMs: number) => Promise<LayoutResult>) | null = null;

/** Đoán hướng trang + phân vùng bố cục ảnh JPEG ở `uri` (file://). Chờ model nạp xong nếu chưa. */
export function analyzeLayout(uri: string, timeoutMs = 30000): Promise<LayoutResult> {
  if (!analyzeImpl) return Promise.reject(new Error('Bộ phân vùng chưa chạy'));
  return analyzeImpl(uri, timeoutMs);
}

/**
 * Bộ hướng trang + phân vùng bố cục (onnxruntime-web) trong một WebView ẩn — mount MỘT LẦN ở gốc app (_layout.tsx) để
 * tải + nạp sẵn model ngay khi mở app; lúc chụp xong chỉ việc gọi analyzeLayout().
 *  - Trang + asset (onnxruntime wasm 14 MB, doc_ori 6.8 MB, S 4.9 MB) nằm trong cache, mở bằng file:// (enginePage.ts).
 *  - Tiến trình web riêng (useSharedProcessPool={false}, iOS): không kéo chết WebView camera; trong trang, phần nặng
 *    chạy ở Web Worker nên luồng chính không bị chặn.
 */
export function LayoutEngine() {
  const webview = useRef<WebViewInstance>(null);
  const [page, setPage] = useState<string | null>(null);
  const loaded = useRef(deferred());
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  // Số lần hệ thống dừng WebView gần đây: dừng liên tục (thiếu bộ nhớ khi nạp model) thì thôi nạp lại, tránh vòng lặp.
  const crashes = useRef<number[]>([]);

  const inject = useCallback((msg: object) => {
    webview.current?.injectJavaScript(`window.__rn && window.__rn(${JSON.stringify(msg)}); true;`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEngineStatus(ALL, { state: 'downloading' });
    writeEnginePage('layout-engine', LAYOUT_HTML, { ort: wasmAsset, ori: oriAsset, S: sAsset }).then(
      (uri) => !cancelled && setPage(uri),
      (e) => !cancelled && setEngineStatus(ALL, { state: 'error', message: (e as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const settle = useCallback((id: number, fn: (p: Pending) => void) => {
    const p = pending.current.get(id);
    if (!p) return;
    pending.current.delete(id);
    clearTimeout(p.timer);
    fn(p);
  }, []);

  useEffect(() => {
    const map = pending.current;
    analyzeImpl = (uri, timeoutMs) => {
      const id = nextId.current++;
      return new Promise<LayoutResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          map.delete(id);
          reject(new Error('Phân vùng bố cục quá lâu'));
        }, timeoutMs);
        map.set(id, { resolve, reject, timer });
        loaded.current.promise.then(() => inject({ type: 'analyze', id, uri, model: 'S', noImage: true }));
      });
    };
    return () => {
      analyzeImpl = null;
      for (const p of map.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Bộ phân vùng đã đóng'));
      }
      map.clear();
    };
  }, [inject]);

  const failAll = (message: string) => {
    for (const id of [...pending.current.keys()]) settle(id, (p) => p.reject(new Error(message)));
  };

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'loaded':
        loaded.current.resolve();
        setEngineStatus(ALL, { state: 'loading' });
        inject({ type: 'preload', models: ['S'] });
        break;
      case 'env':
        console.log(
          `[layout] môi trường: ${msg.cores} lõi · SIMD ${msg.simd ? 'có' : 'không'} · SharedArrayBuffer ${msg.sab ? 'có' : 'không'} · ` +
            `crossOriginIsolated ${msg.isolated ? 'có' : 'không'} · WebGPU ${msg.webgpu} · ${msg.ua}`,
        );
        break;
      case 'session':
        if (msg.name === 'ori' || msg.name === 'S') setEngineStatus([msg.name], { state: 'ready', ms: msg.ms });
        break;
      case 'sessionError':
        // 'ort' (wasm) lỗi thì không model nào chạy được.
        setEngineStatus(msg.name === 'ori' || msg.name === 'S' ? [msg.name] : ALL, { state: 'error', message: String(msg.message) });
        break;
      case 'warn':
        // Worker lỗi/chết: yêu cầu đang chờ sẽ không bao giờ có trả lời -> báo lỗi ngay thay vì chờ hết hạn.
        console.log(`[layout] cảnh báo: ${msg.message}`);
        failAll(String(msg.message));
        setEngineStatus(ALL, { state: 'error', message: String(msg.message) });
        break;
      case 'visibility':
        // 'hidden' = iOS coi WebView này không hiển thị -> tiến trình web có thể bị cho ngủ giữa chừng (xem _layout.tsx).
        console.log(`[layout] trang ${msg.state === 'visible' ? 'đang hiển thị (visible)' : `KHÔNG hiển thị (${msg.state}) — việc dài có thể bị đóng băng`}${msg.id ? ` khi nhận #${msg.id}` : ''}`);
        break;
      case 'stage':
        console.log(`[layout] #${msg.id}: ${msg.stage}…`);
        break;
      case 'layout':
        settle(msg.id, (p) => p.resolve(msg as LayoutResult));
        break;
      case 'layoutError':
        settle(msg.id, (p) => p.reject(new Error(String(msg.message))));
        break;
    }
  };

  const gone = () => {
    const now = Date.now();
    crashes.current = [...crashes.current.filter((t) => now - t < 120000), now];
    console.log(`[layout] WebView phân vùng bị hệ thống dừng (lần ${crashes.current.length} trong 2 phút)`);
    loaded.current = deferred();
    if (crashes.current.length >= 2) {
      const message = 'Bộ phân vùng bị hệ thống dừng liên tục (thiếu bộ nhớ) — mở lại app để thử lại.';
      failAll(message);
      setEngineStatus(ALL, { state: 'error', message });
      return;
    }
    failAll('Bộ phân vùng bị hệ thống dừng (thiếu bộ nhớ?) — đang nạp lại, thử lại sau ít giây.');
    setEngineStatus(ALL, { state: 'loading' });
    webview.current?.reload();
  };

  if (!page) return null;
  return (
    <TypedWebView
      ref={webview}
      style={engineStyles.hidden}
      containerStyle={engineStyles.hidden}
      source={{ uri: page }}
      originWhitelist={['*']}
      javaScriptEnabled
      useSharedProcessPool={false}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      allowingReadAccessToURL={Paths.cache.uri}
      onMessage={onMessage}
      onError={(e) => {
        failAll(`Bộ phân vùng: ${e.nativeEvent.description}`);
        setEngineStatus(ALL, { state: 'error', message: e.nativeEvent.description });
      }}
      onRenderProcessGone={gone}
      onContentProcessDidTerminate={gone}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
