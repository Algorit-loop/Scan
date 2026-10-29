import { type ComponentType, forwardRef, type RefAttributes, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewProps } from 'react-native-webview';

import { WEB_CAMERA_HTML } from './webCameraHtml';

// react-native-webview 14.0.1 khai báo `class WebView<P = undefined>` nên props thành
// `WebViewProps & undefined` = never. Ép lại kiểu cho đúng; runtime không đổi.
type WebViewInstance = WebView<{}>;
const TypedWebView = WebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewInstance>>;

export type WebFrame = {
  /** JPEG base64, không có tiền tố data URL. */
  data: string;
  width: number;
  height: number;
  /** Thời gian vẽ + nén JPEG trong trang web (ms). */
  encodeMs: number;
};

export type WebCameraHandle = {
  grab(maxSide: number, quality: number, timeoutMs?: number): Promise<WebFrame>;
};

type Props = {
  onReady: (size: { width: number; height: number }) => void;
  onError: (message: string) => void;
};

type Pending = { resolve: (f: WebFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Camera chạy trong WebView (getUserMedia) — lấy được khung hình liên tục mà Expo Go vẫn hỗ trợ.
 * baseUrl https://localhost để trang được coi là "secure context", điều kiện bắt buộc của getUserMedia.
 */
export const WebCamera = forwardRef<WebCameraHandle, Props>(function WebCamera({ onReady, onError }, ref) {
  const webview = useRef<WebViewInstance>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);

  useImperativeHandle(ref, () => ({
    grab(maxSide, quality, timeoutMs = 3000) {
      const id = nextId.current++;
      return new Promise<WebFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(new Error('Hết thời gian chờ khung hình'));
        }, timeoutMs);
        pending.current.set(id, { resolve, reject, timer });
        webview.current?.injectJavaScript(
          `window.__rn && window.__rn(${JSON.stringify({ type: 'grab', id, maxSide, quality })}); true;`,
        );
      });
    },
  }));

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') onReady({ width: msg.width, height: msg.height });
      else if (msg.type === 'error') onError(String(msg.message));
      else if (msg.type === 'frame') {
        const p = pending.current.get(msg.id);
        if (!p) return;
        pending.current.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve({ data: msg.data, width: msg.width, height: msg.height, encodeMs: msg.ms });
      }
    },
    [onReady, onError],
  );

  return (
    <TypedWebView
      ref={webview}
      style={styles.webview}
      containerStyle={StyleSheet.absoluteFill}
      source={{ html: WEB_CAMERA_HTML, baseUrl: 'https://localhost' }}
      originWhitelist={['*']}
      javaScriptEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      mediaCapturePermissionGrantType="grant"
      scrollEnabled={false}
      bounces={false}
      onMessage={onMessage}
      onError={(e) => onError(e.nativeEvent.description)}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
});

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: '#000' },
});
