import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScanIcon } from '../components/ScanIcon';
import { allReady, describe, type EngineName, useEngineStatus } from '../layout/status';
import { colors, font } from '../theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const blocked = permission != null && !permission.granted && !permission.canAskAgain;
  const engine = useEngineStatus();

  const openScanner = async () => {
    if (blocked) {
      Linking.openSettings();
      return;
    }
    const granted = permission?.granted || (await requestPermission()).granted;
    if (granted) router.push('/scan');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View>
        <Text style={styles.title} accessibilityRole="header">
          Scan
        </Text>
        <Text style={styles.subtitle}>Quét tài liệu rồi nghe đọc từng câu.</Text>
      </View>

      <Pressable
        onPress={openScanner}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Quét tài liệu"
      >
        <View style={styles.iconWrap}>
          <ScanIcon size={56} color={colors.onAccent} />
        </View>
        <Text style={styles.cardTitle}>Quét tài liệu</Text>
        <Text style={styles.cardBody}>
          {blocked ? 'Camera đang bị chặn — chạm để mở Cài đặt.' : 'Đưa trang giấy vào khung, giữ yên rồi bấm chụp. Máy sẽ đọc nội dung thành tiếng.'}
        </Text>
      </Pressable>

      <View style={styles.engine} accessibilityLiveRegion="polite">
        <Text style={styles.engineTitle}>Bộ xử lý trên máy</Text>
        {PARTS.map(([label, names]) => (
          <Text key={label} style={styles.engineLine}>
            {allReady(engine, names) ? '●' : '○'} {label}: {describe(engine, names)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Các phần nạp sẵn lúc mở app (chạy trong WebView ẩn, không cần mạng). */
const PARTS: [string, EngineName[]][] = [
  ['Nhận dạng chữ tiếng Việt', ['ocr']],
  ['Hướng trang + bố cục', ['ori', 'S']],
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24, justifyContent: 'space-between' },
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
  engine: { gap: 2 },
  engineTitle: { color: colors.textMuted, fontSize: font.small, fontWeight: '700' },
  engineLine: { color: colors.textMuted, fontSize: font.small },
});
