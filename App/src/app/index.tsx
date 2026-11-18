import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScanIcon } from '../components/ScanIcon';
import { colors, font } from '../theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const blocked = permission != null && !permission.granted && !permission.canAskAgain;

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
        <Text style={styles.subtitle}>Quét tài liệu thành ảnh phẳng, rõ nét.</Text>
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
          {blocked ? 'Camera đang bị chặn — chạm để mở Cài đặt.' : 'Đưa trang giấy vào khung, giữ yên rồi bấm chụp.'}
        </Text>
      </Pressable>

      <View />
    </View>
  );
}

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
});
