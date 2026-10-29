import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Scan } from '../storage/scans';
import { colors, font } from '../theme';
import { formatDateTime, spokenDateTime } from '../utils/format';

type Props = {
  scan: Scan;
  onOpen: (scan: Scan) => void;
  onDelete: (scan: Scan) => void;
};

export const ScanRow = memo(function ScanRow({ scan, onOpen, onDelete }: Props) {
  const title = `Tài liệu ${scan.number}`;
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => onOpen(scan)}
      onLongPress={() => onDelete(scan)}
      accessibilityRole="button"
      accessibilityLabel={`${title}, quét lúc ${spokenDateTime(scan.createdAt)}`}
      accessibilityHint="Chạm hai lần để xem. Vuốt lên hoặc xuống để chọn tác vụ xóa."
      accessibilityActions={[
        { name: 'activate', label: 'Xem' },
        { name: 'delete', label: 'Xóa tài liệu' },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'delete') onDelete(scan);
        else onOpen(scan);
      }}
    >
      <Image source={{ uri: scan.thumbUri }} style={styles.thumb} contentFit="cover" />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.meta}>{formatDateTime(scan.createdAt)}</Text>
        <Text style={styles.meta}>
          {scan.width} × {scan.height}
        </Text>
      </View>
      <Text style={styles.chevron} importantForAccessibility="no" accessibilityElementsHidden>
        ›
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 96,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  pressed: { backgroundColor: colors.surface },
  thumb: {
    width: 64,
    height: 80,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  info: { flex: 1, gap: 4 },
  title: { color: colors.text, fontSize: font.body + 2, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 17 },
  chevron: { color: colors.textMuted, fontSize: 36 },
});
