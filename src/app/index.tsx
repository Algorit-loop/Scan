import { router } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmDelete } from '../components/confirmDelete';
import { FabButton } from '../components/FabButton';
import { ScanRow } from '../components/ScanRow';
import { type Scan, useScans } from '../storage/scans';
import { colors, font } from '../theme';

export default function ScanListScreen() {
  const { scans, loaded } = useScans();
  const insets = useSafeAreaInsets();
  const fabBottom = Math.max(insets.bottom, 16) + 8;

  const open = useCallback((s: Scan) => router.push(`/doc/${s.id}`), []);
  const remove = useCallback((s: Scan) => confirmDelete(s), []);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Đang tải danh sách" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={scans}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <ScanRow scan={item} onOpen={open} onDelete={remove} />}
        contentContainerStyle={[{ paddingBottom: fabBottom + 110 }, scans.length === 0 && styles.grow]}
        ListHeaderComponent={
          scans.length > 0 ? (
            <Text style={styles.count} accessibilityRole="summary">
              {scans.length} tài liệu
            </Text>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Chưa có tài liệu nào</Text>
            <Text style={styles.emptyBody}>
              Chạm nút tròn màu vàng ở giữa, cuối màn hình để bắt đầu quét.
            </Text>
          </View>
        }
      />
      <FabButton onPress={() => router.push('/scan')} bottom={fabBottom} label="Quét tài liệu mới" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1 },
  count: {
    color: colors.textMuted,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { color: colors.text, fontSize: font.title, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 28 },
});
