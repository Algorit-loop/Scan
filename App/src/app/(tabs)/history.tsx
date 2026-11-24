import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openHistoryItem } from '../../history/open';
import { clearHistory, itemImage, removeHistoryItem, useHistory } from '../../history/store';
import { formatWhen, type HistoryItem, progressLabel } from '../../history/summary';
import { colors, font } from '../../theme';

/**
 * Lịch sử quét (lưu trên máy). Chạm một mục để mở lại kết quả cuối cùng của lần quét đó và đọc tiếp từ câu đang dở.
 */
export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { items, loaded } = useHistory();
  const [opening, setOpening] = useState<string | null>(null);

  const open = async (item: HistoryItem) => {
    if (opening) return;
    setOpening(item.id);
    try {
      if (await openHistoryItem(item.id)) router.push('/result');
      else Alert.alert('Không mở được', 'Dữ liệu của mục này đã hỏng hoặc bị xóa.');
    } finally {
      setOpening(null);
    }
  };

  const remove = (item: HistoryItem) =>
    Alert.alert('Xóa mục này?', item.title, [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Xóa', style: 'destructive', onPress: () => removeHistoryItem(item.id) },
    ]);

  const removeAll = () =>
    Alert.alert('Xóa toàn bộ lịch sử?', `${items.length} tài liệu đã quét trên máy này sẽ bị xóa, không khôi phục được.`, [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Xóa hết', style: 'destructive', onPress: clearHistory },
    ]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">
            Lịch sử
          </Text>
          <Text style={styles.subtitle}>{items.length ? `${items.length} tài liệu, lưu trên máy này` : 'Lưu trên máy này'}</Text>
        </View>
        {items.length > 0 && (
          <Pressable onPress={removeAll} style={styles.clear} accessibilityRole="button" accessibilityLabel="Xóa toàn bộ lịch sử" hitSlop={8}>
            <Text style={styles.clearText}>Xóa hết</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loaded ? (
            <Text style={styles.empty}>Chưa có tài liệu nào. Vào Trang chủ, bấm Quét tài liệu — mỗi lần quét xong sẽ tự lưu vào đây.</Text>
          ) : (
            <ActivityIndicator color={colors.accent} />
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              onPress={() => open(item)}
              onLongPress={() => remove(item)}
              style={({ pressed }) => [styles.item, (pressed || opening === item.id) && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${progressLabel(item)}. Quét ${formatWhen(item.createdAt)}`}
              accessibilityHint="Chạm hai lần để mở và đọc tiếp. Nhấn giữ để xóa."
            >
              <Image source={{ uri: itemImage(item.id, item.hasEnhanced ? 'enhanced' : 'original') }} style={styles.thumb} contentFit="cover" />
              <View style={styles.info}>
                <Text style={styles.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.itemProgress}>{progressLabel(item)}</Text>
                <Text style={styles.itemWhen}>{formatWhen(item.createdAt)}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => remove(item)} style={styles.delete} accessibilityRole="button" accessibilityLabel={`Xóa: ${item.title}`}>
              <Text style={styles.deleteText}>Xóa</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 24, paddingBottom: 12, gap: 12 },
  title: { color: colors.text, fontSize: font.huge, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: font.small, marginTop: 4 },
  clear: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  clearText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  empty: { color: colors.textMuted, fontSize: font.body, lineHeight: 26, paddingHorizontal: 8, paddingTop: 24 },
  row: { flexDirection: 'row', alignItems: 'stretch', backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden' },
  item: { flex: 1, flexDirection: 'row', gap: 12, padding: 12, alignItems: 'center' },
  thumb: { width: 60, height: 80, borderRadius: 8, backgroundColor: colors.border },
  info: { flex: 1, gap: 4 },
  itemTitle: { color: colors.text, fontSize: font.body, fontWeight: '700', lineHeight: 24 },
  itemProgress: { color: colors.accent, fontSize: font.small, fontWeight: '700' },
  itemWhen: { color: colors.textMuted, fontSize: font.small },
  delete: { width: 64, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  deleteText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
