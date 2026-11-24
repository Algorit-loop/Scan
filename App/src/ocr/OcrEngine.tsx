import { Paths } from 'expo-file-system';
import { type ComponentType, type RefAttributes, useCallback, useEffect, useRef, useState } from 'react';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import coreAsset from '../../assets/ocr/tesseract-core-simd-lstm.wasm';
import vieAsset from '../../assets/ocr/vie.traineddata';
import { deferred, engineStyles, writeEnginePage } from '../engine/enginePage';
import { setEngineStatus } from '../layout/status';
import type { OcrLine } from '../reading/compose';
import { OCR_HTML } from './ocr.generated';

// Xem ScannerView.tsx: react-native-webview 14.0.1 khai báo kiểu sai, ép lại cho đúng.
type WebViewInstance = WebView<object>;
const TypedWebView = WebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewInstance>>;

export type OcrResult = {
  /** Kích thước ảnh đưa vào (tọa độ của `lines` theo hệ này). */
  width: number;
  height: number;
  /** Kích thước ảnh Tesseract thực sự đọc (sau khi phóng to / thu nhỏ). */
  ocrSize: [number, number];
  lines: OcrLine[];
  /** Độ tin cậy trung bình của mọi từ (0..100). */
  conf: number;
  /** ms: load = chờ bộ nhận dạng nạp xong, decode = giải mã JPEG, pre = tiền xử lý, ocr = Tesseract, total (trừ load). */
  ms: { load: number; decode: number; pre: number; ocr: number; total: number };
};
type Pending = { resolve: (r: OcrResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

// ---------- Cầu nối tới engine đang mount (một engine cho cả app) ----------

let recognizeImpl: ((uri: string, timeoutMs: number) => Promise<OcrResult>) | null = null;

/** Nhận dạng chữ trong ảnh JPEG đã dựng thẳng ở `uri` (file://). Chờ bộ nhận dạng nạp xong nếu chưa. */
export function recognizeText(uri: string, timeoutMs = 30000): Promise<OcrResult> {
  if (!recognizeImpl) return Promise.reject(new Error('Bộ nhận dạng chữ chưa chạy'));
  return recognizeImpl(uri, timeoutMs);
}

/**
 * Bộ nhận dạng chữ tiếng Việt: Tesseract 5 (LSTM) biên dịch sang WebAssembly, chạy trong một WebView ẩn — mount MỘT LẦN
 * ở gốc app (_layout.tsx), nạp sẵn khi mở app. Không cần mạng, không cần module native nên chạy được trong Expo Go.
 *  - Asset: tesseract-core-simd-lstm.wasm (2.9 MB) + vie.traineddata (0.5 MB, tessdata_fast).
 *  - Trong trang: Worker làm tiền xử lý (khử bóng, đổi cỡ) + Tesseract; luồng chính chỉ giải mã JPEG.
 *  - Tiến trình web riêng (useSharedProcessPool={false}, iOS) như bộ phân vùng bố cục.
 */
export function OcrEngine() {
  const webview = useRef<WebViewInstance>(null);
  const [page, setPage] = useState<string | null>(null);
  const loaded = useRef(deferred());
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const crashes = useRef<number[]>([]);

  const inject = useCallback((msg: object) => {
    webview.current?.injectJavaScript(`window.__rn && window.__rn(${JSON.stringify(msg)}); true;`);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEngineStatus(['ocr'], { state: 'downloading' });
    writeEnginePage('ocr-engine', OCR_HTML, { core: coreAsset, vie: vieAsset }).then(
      (uri) => !cancelled && setPage(uri),
      (e) => !cancelled && setEngineStatus(['ocr'], { state: 'error', message: (e as Error).message }),
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
    recognizeImpl = (uri, timeoutMs) => {
      const id = nextId.current++;
      return new Promise<OcrResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          map.delete(id);
          reject(new Error('Nhận dạng chữ quá lâu'));
        }, timeoutMs);
        map.set(id, { resolve, reject, timer });
        loaded.current.promise.then(() => inject({ type: 'ocr', id, uri }));
      });
    };
    return () => {
      recognizeImpl = null;
      for (const p of map.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Bộ nhận dạng chữ đã đóng'));
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
        setEngineStatus(['ocr'], { state: 'loading' });
        inject({ type: 'preload' });
        break;
      case 'ready':
        setEngineStatus(['ocr'], { state: 'ready', ms: msg.ms });
        break;
      case 'engineError':
        setEngineStatus(['ocr'], { state: 'error', message: String(msg.message) });
        break;
      case 'warn':
        // Worker lỗi/chết: yêu cầu đang chờ sẽ không bao giờ có trả lời -> báo lỗi ngay.
        console.log(`[ocr] cảnh báo: ${msg.message}`);
        failAll(String(msg.message));
        setEngineStatus(['ocr'], { state: 'error', message: String(msg.message) });
        break;
      case 'visibility':
        // 'hidden' = iOS coi WebView này không hiển thị -> tiến trình web có thể bị cho ngủ giữa chừng (xem _layout.tsx).
        console.log(`[ocr] trang ${msg.state === 'visible' ? 'đang hiển thị (visible)' : `KHÔNG hiển thị (${msg.state}) — việc dài có thể bị đóng băng`}${msg.id ? ` khi nhận #${msg.id}` : ''}`);
        break;
      case 'stage':
        console.log(`[ocr] #${msg.id}: ${msg.stage}…`);
        break;
      case 'text':
        settle(msg.id, (p) => p.resolve(msg as OcrResult));
        break;
      case 'ocrError':
        settle(msg.id, (p) => p.reject(new Error(String(msg.message))));
        break;
    }
  };

  const gone = () => {
    const now = Date.now();
    crashes.current = [...crashes.current.filter((t) => now - t < 120000), now];
    console.log(`[ocr] WebView nhận dạng chữ bị hệ thống dừng (lần ${crashes.current.length} trong 2 phút)`);
    loaded.current = deferred();
    if (crashes.current.length >= 2) {
      const message = 'Bộ nhận dạng chữ bị hệ thống dừng liên tục (thiếu bộ nhớ) — mở lại app để thử lại.';
      failAll(message);
      setEngineStatus(['ocr'], { state: 'error', message });
      return;
    }
    failAll('Bộ nhận dạng chữ bị hệ thống dừng (thiếu bộ nhớ?) — đang nạp lại, thử lại sau ít giây.');
    setEngineStatus(['ocr'], { state: 'loading' });
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
        failAll(`Bộ nhận dạng chữ: ${e.nativeEvent.description}`);
        setEngineStatus(['ocr'], { state: 'error', message: e.nativeEvent.description });
      }}
      onRenderProcessGone={gone}
      onContentProcessDidTerminate={gone}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
