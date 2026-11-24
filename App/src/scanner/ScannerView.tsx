import { type ComponentType, forwardRef, type RefAttributes, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { SCANNER_HTML } from './page.generated';
import type { ScanSettings } from './settings';

// react-native-webview 14.0.1 khai báo `class WebView<P = undefined>` nên props thành
// `WebViewProps & undefined` = never. Ép lại kiểu cho đúng; runtime không đổi.
type WebViewInstance = WebView<object>;
const TypedWebView = WebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewInstance>>;

/** Gợi ý do trang quét tính (web/page.js > computeHint). */
export type Hint = 'starting' | 'no-engine' | 'search' | 'dark' | 'closer' | 'farther' | 'hold' | 'ready' | 'found';

export type Captured = { data: string; width: number; height: number; flattened: boolean };

export type Perf = { fps: number; ms: number; rt: number };

export type ScannerHandle = {
  /** Chụp và nắn phẳng; trả JPEG base64. Khung hình đứng yên cho tới khi gọi resume(). */
  capture(timeoutMs?: number): Promise<Captured>;
  /** Chạy lại camera + detect sau khi chụp. */
  resume(): void;
};

type Props = {
  settings: ScanSettings;
  onCamera?: (size: { width: number; height: number }) => void;
  onEngine?: (ok: boolean, message?: string) => void;
  onStatus?: (hint: Hint, steady: boolean) => void;
  onPerf?: (perf: Perf) => void;
  onError?: (message: string) => void;
};

type Pending = { resolve: (c: Captured) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Camera + docdetect_v3 (WebAssembly) chạy trong WebView, để Expo Go vẫn chạy được.
 * baseUrl https://localhost để trang là "secure context" — điều kiện của getUserMedia.
 */
export const ScannerView = forwardRef<ScannerHandle, Props>(function ScannerView(props, ref) {
  const webview = useRef<WebViewInstance>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const handlers = useRef(props);
  handlers.current = props;

  const post = useCallback((msg: object) => {
    webview.current?.injectJavaScript(`window.__rn && window.__rn(${JSON.stringify(msg)}); true;`);
  }, []);
  const sendConfig = useCallback(() => post({ type: 'config', ...handlers.current.settings }), [post]);

  // Đổi tùy chọn -> báo trang ngay (trang cũng nhận lại khi camera/engine sẵn sàng, phòng lúc chưa tải xong).
  const { detectSide, tracker } = props.settings;
  useEffect(() => {
    post({ type: 'config', detectSide, tracker });
  }, [post, detectSide, tracker]);

  useImperativeHandle(ref, () => ({
    capture(timeoutMs = 15000) {
      const id = nextId.current++;
      return new Promise<Captured>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error('Xử lý ảnh quá lâu'));
        }, timeoutMs);
        pending.current.set(id, { resolve, reject, timer });
        post({ type: 'capture', id });
      });
    },
    resume() {
      post({ type: 'resume' });
    },
  }));

  const settle = (id: number, fn: (p: Pending) => void) => {
    const p = pending.current.get(id);
    if (!p) return;
    pending.current.delete(id);
    clearTimeout(p.timer);
    fn(p);
  };

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const h = handlers.current;
    switch (msg.type) {
      case 'camera':
        sendConfig();
        h.onCamera?.({ width: msg.width, height: msg.height });
        break;
      case 'engine':
        sendConfig();
        h.onEngine?.(!!msg.ok, msg.message);
        break;
      case 'status':
        h.onStatus?.(msg.hint, !!msg.steady);
        break;
      case 'perf':
        h.onPerf?.({ fps: msg.fps, ms: msg.ms, rt: msg.rt });
        break;
      case 'error':
        h.onError?.(String(msg.message));
        break;
      case 'captured':
        settle(msg.id, (p) =>
          p.resolve({ data: msg.data, width: msg.width, height: msg.height, flattened: !!msg.flattened }),
        );
        break;
      case 'captureError':
        settle(msg.id, (p) => p.reject(new Error(String(msg.message))));
        break;
    }
  }, [sendConfig]);

  return (
    <TypedWebView
      ref={webview}
      style={styles.webview}
      containerStyle={StyleSheet.absoluteFill}
      source={{ html: SCANNER_HTML, baseUrl: 'https://localhost' }}
      originWhitelist={['*']}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      onMessage={onMessage}
      onError={(e) => handlers.current.onError?.(e.nativeEvent.description)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
});

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: '#000' },
});
