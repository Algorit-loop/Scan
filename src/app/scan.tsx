import { CameraView } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WebCamera, type WebCameraHandle } from '../camera/WebCamera';
import { DetectionOverlay } from '../components/DetectionOverlay';
import { PerfPanel } from '../components/PerfPanel';
import { say, stopSpeaking } from '../feedback/announcer';
import { INSTRUCTION_TEXT, MESSAGES } from '../guidance/messages.vi';
import { SHOW_PERF, WEB_CAMERA_TIMEOUT_MS } from '../scan/config';
import type { CameraMode } from '../scan/types';
import { useCapture } from '../scan/useCapture';
import { useFrameLoop } from '../scan/useFrameLoop';
import { useServerConnection } from '../scan/useServerConnection';
import { colors, font, MIN_TOUCH } from '../theme';

export default function ScanScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const nativeCam = useRef<CameraView>(null);
  const webCam = useRef<WebCameraHandle>(null);

  const [mode, setMode] = useState<CameraMode>('web');
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const { client, status: serverStatus } = useServerConnection();
  const { view, stats, last, pause, resume } = useFrameLoop({ mode, ready, webCam, nativeCam, client });
  const { busy, capture, saved } = useCapture({ mode, ready, webCam, nativeCam, client, last, pause, resume });

  useEffect(() => {
    say(MESSAGES.scanStart, { important: true });
    return () => {
      // Để câu "Đã lưu tài liệu" được đọc hết khi quay về danh sách.
      if (!saved.current) stopSpeaking();
    };
  }, [saved]);

  const switchToNative = useCallback((reason: string) => {
    console.warn(`[camera] WebView camera lỗi, chuyển sang chế độ chụp ảnh: ${reason}`);
    setReady(false);
    setMode('native');
    say(MESSAGES.fallbackNativeCamera);
  }, []);

  // Camera WebView không sẵn sàng sau một lúc -> dự phòng sang expo-camera.
  useEffect(() => {
    if (mode !== 'web' || ready) return;
    const t = setTimeout(() => switchToNative('hết thời gian chờ'), WEB_CAMERA_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mode, ready, switchToNative]);

  const { instruction, aligned, analysis } = view;
  const label = busy
    ? MESSAGES.capturing
    : aligned
      ? 'Đã căn chỉnh — chạm để chụp'
      : instruction
        ? INSTRUCTION_TEXT[instruction]
        : 'Đang khởi động camera…';

  return (
    <View style={styles.container}>
      {mode === 'web' ? (
        <WebCamera
          ref={webCam}
          onReady={() => setReady(true)}
          onError={(msg) => {
            if (!ready) switchToNative(msg);
          }}
        />
      ) : (
        <CameraView
          ref={nativeCam}
          style={StyleSheet.absoluteFill}
          facing="back"
          animateShutter={false}
          onCameraReady={() => setReady(true)}
          onMountError={(e) => {
            setCameraError(e.message);
            say('Không mở được camera', { important: true });
          }}
        />
      )}

      <DetectionOverlay
        result={analysis?.result ?? null}
        frameWidth={analysis?.frameWidth ?? 0}
        frameHeight={analysis?.frameHeight ?? 0}
        aligned={aligned}
      />

      {/* Chạm bất kỳ đâu để chụp. Với VoiceOver/TalkBack: chạm hai lần. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={capture}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={aligned ? 'Đã căn chỉnh. Chụp tài liệu' : 'Chụp tài liệu'}
        accessibilityHint="Chạm hai lần để chụp ngay"
      />

      <View
        pointerEvents="none"
        style={[styles.panel, aligned && styles.panelAligned, { paddingBottom: insets.bottom + 20 }]}
        // Ứng dụng đã tự đọc chỉ dẫn bằng giọng nói — ẩn khỏi trình đọc màn hình để không đọc trùng.
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {busy && <ActivityIndicator color={colors.onAccent} size="large" />}
        <Text style={[styles.instruction, aligned && styles.instructionAligned]}>
          {cameraError ? `Lỗi camera: ${cameraError}` : label}
        </Text>
      </View>

      {SHOW_PERF && <PerfPanel mode={mode} serverStatus={serverStatus} stats={stats} top={insets.top + 12} />}

      <Pressable
        style={({ pressed }) => [styles.close, { top: insets.top + 12 }, pressed && styles.pressed]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Đóng, quay lại danh sách"
        hitSlop={8}
      >
        <Text style={styles.closeText}>Đóng</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 20,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    gap: 8,
  },
  panelAligned: { backgroundColor: colors.success },
  instruction: { color: colors.text, fontSize: font.huge, fontWeight: '800', textAlign: 'center' },
  instructionAligned: { color: colors.onAccent },
  close: {
    position: 'absolute',
    left: 16,
    minHeight: MIN_TOUCH,
    minWidth: 96,
    paddingHorizontal: 18,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 2,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  closeText: { color: colors.text, fontSize: font.body, fontWeight: '700' },
});
