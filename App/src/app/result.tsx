import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLastScan } from '../scanner/lastScan';
import { colors, font, MIN_TOUCH } from '../theme';

export default function ResultScreen() {
  const insets = useSafeAreaInsets();
  const scan = getLastScan();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <Text style={styles.title} accessibilityRole="header">
        {scan?.flattened === false ? 'Không thấy tài liệu — ảnh gốc' : 'Ảnh đã nắn phẳng'}
      </Text>
      {scan && (
        <Text style={styles.meta}>
          {scan.width} × {scan.height}
        </Text>
      )}

      <View style={styles.preview}>
        {scan ? (
          <Image
            source={{ uri: scan.uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessible
            accessibilityLabel="Ảnh tài liệu vừa chụp"
          />
        ) : (
          <Text style={styles.meta}>Chưa có ảnh.</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
          onPress={() => router.back()}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Chụp lại</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}
          onPress={() => router.dismissTo('/')}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>Xong</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, gap: 8 },
  title: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: font.small },
  preview: {
    flex: 1,
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, minHeight: MIN_TOUCH, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  secondary: { borderWidth: 2, borderColor: colors.text },
  secondaryText: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: colors.onAccent, fontSize: font.body, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
