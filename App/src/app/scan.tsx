import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segment, SEGMENT_H } from '../components/Segment';
import { runAnalysis } from '../reading/runAnalysis';
import { saveScan } from '../scanner/lastScan';
import { type Hint, type Perf, type ScannerHandle, ScannerView } from '../scanner/ScannerView';
import { useScanSettings } from '../scanner/settings';
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
  found: 'Đã thấy tài liệu (không Tracker)',
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
  const [settings, updateSettings] = useScanSettings();

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
      await saveScan(shot.data, { width: shot.width, height: shot.height, flattened: shot.flattened }, shot.enhanced);
      // Phân tích chạy nền ngay (hướng trang -> nhận dạng chữ -> tách câu); màn kết quả hiện tiến độ rồi nội dung.
      runAnalysis();
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
        settings={settings}
        onCamera={() => setCameraOn(true)}
        onEngine={(ok, message) => !ok && message && setError(message)}
        onStatus={onStatus}
        onPerf={setPerf}
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
        {/* Đặt bên trái, chừa góc phải cho nút cài đặt nổi của Expo Go. */}
        <View style={styles.options}>
          <Segment
            label="Khung"
            value={settings.detectSide}
            options={[[256, '256'], [640, '640']]}
            onChange={(detectSide) => {
              setPerf(null);
              updateSettings({ detectSide });
            }}
          />
          <Segment
            label="Theo dõi"
            value={settings.tracker}
            options={[[true, 'Tracker'], [false, 'Không']]}
            onChange={(tracker) => updateSettings({ tracker })}
          />
          <Segment
            label="Camera"
            value={settings.cameraHeight}
            options={[[1080, '1080p'], [2160, '4K']]}
            onChange={(cameraHeight) => {
              setPerf(null);
              updateSettings({ cameraHeight });
            }}
          />
        </View>
      </View>

      {perf && (
        <Text style={[styles.perf, { top: insets.top + 8 + OPTIONS_HEIGHT + 8 }]}>
          detect {perf.fps.toFixed(1)} lần/s · {perf.ms.toFixed(1)} ms · vòng {perf.rt.toFixed(0)} ms · {settings.detectSide}px ·{' '}
          {settings.tracker ? 'Tracker' : 'không Tracker'}
        </Text>
      )}

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

const OPTIONS_HEIGHT = SEGMENT_H * 3 + 16;
const SHUTTER = 80;
const INNER = SHUTTER - 16;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  options: { gap: 8, alignItems: 'flex-start' },
  close: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.text, fontSize: 24, fontWeight: '600' },
  perf: {
    position: 'absolute',
    left: 16,
    color: colors.text,
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
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
