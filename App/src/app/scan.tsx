import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { saveScan } from '../scanner/lastScan';
import { type Hint, type Perf, type ScannerHandle, ScannerView } from '../scanner/ScannerView';
import { colors, font, MIN_TOUCH } from '../theme';

const HINT_TEXT: Record<Hint, string> = {
  starting: 'Đang khởi động…',
  'no-engine': 'Chưa có bộ nhận diện — chỉ chụp được ảnh gốc',
  search: 'Đưa tài liệu vào khung hình',
  dark: 'Thiếu sáng hoặc nền quá giống màu giấy',
  closer: 'Đưa camera lại gần hơn',
  farther: 'Lùi ra xa để thấy đủ 4 góc',
  hold: 'Giữ yên máy…',
  ready: 'Sẵn sàng — bấm chụp',
};

export default function ScanScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const scanner = useRef<ScannerHandle>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [hint, setHint] = useState<Hint>('starting');
  const [steady, setSteady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState<Perf | null>(null);
  const wasSteady = useRef(false);

  // Quay lại từ màn kết quả ("Chụp lại"): chạy lại camera + detect.
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) scanner.current?.resume();
      focused.current = true;
    }, []),
  );

  const onStatus = useCallback((h: Hint, s: boolean) => {
    setHint(h);
    setSteady(s);
    // Rung nhẹ một lần khi khung vừa chuyển sang đứng yên.
    if (s && !wasSteady.current) Haptics.selectionAsync().catch(() => {});
    wasSteady.current = s;
  }, []);

  const capture = async () => {
    if (busy || !cameraOn || !scanner.current) return;
    setBusy(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const shot = await scanner.current.capture();
      await saveScan(shot.data, { width: shot.width, height: shot.height, flattened: shot.flattened });
      router.push('/result');
    } catch (e) {
      setError((e as Error).message);
      scanner.current?.resume();
    } finally {
      setBusy(false);
    }
  };

  const ready = hint === 'ready';
  return (
    <View style={styles.container}>
      <ScannerView
        ref={scanner}
        onCamera={() => setCameraOn(true)}
        onEngine={(ok, message) => !ok && message && setError(message)}
        onStatus={onStatus}
        onPerf={__DEV__ ? setPerf : undefined}
        onError={setError}
      />

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Đóng"
          hitSlop={8}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        {perf && (
          <Text style={styles.perf}>
            {perf.fps.toFixed(1)} lần/s · detect {perf.ms.toFixed(0)} ms · vòng {perf.rt.toFixed(0)} ms
          </Text>
        )}
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]} pointerEvents="box-none">
        <View style={[styles.hint, ready && styles.hintReady]} accessibilityLiveRegion="polite">
          <Text style={[styles.hintText, ready && styles.hintTextReady]}>
            {cameraOn ? HINT_TEXT[hint] : 'Đang mở camera…'}
          </Text>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={({ pressed }) => [styles.shutter, steady && styles.shutterSteady, pressed && styles.pressed]}
          onPress={capture}
          disabled={busy || !cameraOn}
          accessibilityRole="button"
          accessibilityLabel="Chụp"
          accessibilityState={{ disabled: busy || !cameraOn, busy }}
        >
          {busy ? <ActivityIndicator color={colors.onAccent} size="large" /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const SHUTTER = 80;
const INNER = SHUTTER - 16;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 8, alignItems: 'flex-start' },
  close: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.text, fontSize: 24, fontWeight: '600' },
  perf: { color: colors.textMuted, fontSize: 12, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4, borderRadius: 4 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: 16, paddingHorizontal: 16 },
  hint: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22 },
  hintReady: { backgroundColor: colors.success },
  hintText: { color: colors.text, fontSize: font.body, fontWeight: '600', textAlign: 'center' },
  hintTextReady: { color: colors.onAccent },
  error: {
    color: colors.danger,
    fontSize: font.small,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 8,
    borderRadius: 8,
  },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterSteady: { borderColor: colors.success },
  shutterInner: { width: INNER, height: INNER, borderRadius: INNER / 2, backgroundColor: colors.text },
  pressed: { opacity: 0.6 },
});
