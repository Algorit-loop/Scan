import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/session';
import { ScanIcon } from '../../components/ScanIcon';
import { openHistoryItem } from '../../history/open';
import { useHistory } from '../../history/store';
import { formatWhen, progressLabel } from '../../history/summary';
import { allReady, describe, type EngineName, useEngineStatus } from '../../layout/status';
import { colors, font } from '../../theme';

/** Trang chủ: lời chào, nút quét, đọc tiếp tài liệu gần nhất, trạng thái các bộ xử lý trên máy. */
export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const blocked = permission != null && !permission.granted && !permission.canAskAgain;
  const engine = useEngineStatus();
  const { items } = useHistory();
  const latest = items[0];
  const [opening, setOpening] = useState(false);

  const openScanner = async () => {
    if (blocked) {
      Linking.openSettings();
      return;
    }
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) router.push('/scan');
  };

  const resume = async () => {
    if (!latest || opening) return;
    setOpening(true);
    try {
      if (await openHistoryItem(latest.id)) router.push('/result');
    } finally {
      setOpening(false);
    }
  };

  const name = auth.status === 'signedIn' ? auth.user.name : '';
  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <View>
        <Text style={styles.title} accessibilityRole="header">
          Xin chào{name ? `, ${name}` : ''}
        </Text>
        <Text style={styles.subtitle}>Quét tài liệu rồi nghe đọc từng câu.</Text>
      </View>

      <Pressable
        onPress={openScanner}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Quét tài liệu"
        accessibilityHint="Mở camera để chụp một trang giấy"
      >
        <View style={styles.iconWrap}>
          <ScanIcon size={56} color={colors.onAccent} />
        </View>
        <Text style={styles.cardTitle}>Quét tài liệu</Text>
        <Text style={styles.cardBody}>
          {blocked
            ? 'Camera đang bị chặn — chạm để mở Cài đặt.'
            : 'Đưa trang giấy vào khung, giữ yên rồi bấm chụp. Máy sẽ đọc nội dung thành tiếng.'}
        </Text>
      </Pressable>

      {latest && (
        <Pressable
          onPress={resume}
          disabled={opening}
          style={({ pressed }) => [styles.resume, (pressed || opening) && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Đọc tiếp: ${latest.title}. ${progressLabel(latest)}. Quét ${formatWhen(latest.createdAt)}`}
        >
          <Text style={styles.resumeKicker}>Đọc tiếp</Text>
          <Text style={styles.resumeTitle} numberOfLines={2}>
            {latest.title}
          </Text>
          <Text style={styles.resumeMeta}>
            {progressLabel(latest)} · {formatWhen(latest.createdAt)}
          </Text>
        </Pressable>
      )}

      <View style={styles.engine} accessibilityLiveRegion="polite">
        <Text style={styles.engineTitle}>Bộ xử lý trên máy (không cần mạng)</Text>
        {PARTS.map(([label, names]) => (
          <Text key={label} style={styles.engineLine}>
            {allReady(engine, names) ? '●' : '○'} {label}: {describe(engine, names)}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

/** Các phần nạp sẵn lúc mở app (chạy trong WebView ẩn, không cần mạng). */
const PARTS: [string, EngineName[]][] = [
  ['Nhận dạng chữ tiếng Việt', ['ocr']],
  ['Hướng trang + bố cục', ['ori', 'S']],
];

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 24, paddingBottom: 24, gap: 24 },
  title: { color: colors.text, fontSize: font.huge, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: font.body, marginTop: 6 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 28,
    alignItems: 'center',
    gap: 14,
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  iconWrap: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  cardBody: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 26 },
  resume: { borderRadius: 18, borderWidth: 2, borderColor: colors.accent, padding: 18, gap: 6 },
  resumeKicker: { color: colors.accent, fontSize: font.small, fontWeight: '800' },
  resumeTitle: { color: colors.text, fontSize: font.body, fontWeight: '700', lineHeight: 26 },
  resumeMeta: { color: colors.textMuted, fontSize: font.small },
  engine: { gap: 2 },
  engineTitle: { color: colors.textMuted, fontSize: font.small, fontWeight: '700' },
  engineLine: { color: colors.textMuted, fontSize: font.small },
});
