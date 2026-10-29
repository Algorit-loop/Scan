import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmDelete } from '../../components/confirmDelete';
import { useScan } from '../../storage/scans';
import { colors, font, MIN_TOUCH } from '../../theme';
import { spokenDateTime } from '../../utils/format';

export default function ScanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scan = useScan(id);
  const insets = useSafeAreaInsets();

  if (!scan) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>Không tìm thấy tài liệu.</Text>
      </View>
    );
  }

  const share = async () => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(scan.uri, { mimeType: 'image/jpeg' });
    }
  };

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <Stack.Screen options={{ title: `Tài liệu ${scan.number}` }} />
      <Image
        source={{ uri: scan.uri }}
        style={styles.image}
        contentFit="contain"
        accessible
        accessibilityLabel={`Ảnh tài liệu ${scan.number}, quét lúc ${spokenDateTime(scan.createdAt)}`}
      />
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Chia sẻ ảnh"
        >
          <Text style={[styles.buttonText, styles.primaryText]}>Chia sẻ</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, styles.danger, pressed && styles.pressed]}
          onPress={() => confirmDelete(scan, () => router.back())}
          accessibilityRole="button"
          accessibilityLabel="Xóa tài liệu"
        >
          <Text style={styles.buttonText}>Xóa</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  body: { color: colors.text, fontSize: font.body },
  image: { flex: 1, margin: 12 },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  button: {
    flex: 1,
    minHeight: MIN_TOUCH + 8,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  danger: { backgroundColor: 'transparent', borderColor: colors.danger },
  pressed: { opacity: 0.7 },
  buttonText: { color: colors.danger, fontSize: font.title, fontWeight: '700' },
  primaryText: { color: colors.onAccent },
});
