import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, font } from '../theme';

/** Nhóm nút chọn một (radio) nhỏ gọn, dùng cho tùy chọn thử nghiệm. */
export function Segment<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <Pressable
            key={String(v)}
            onPress={() => onChange(v)}
            style={[styles.item, on && styles.on]}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${label} ${text}`}
            hitSlop={4}
          >
            <Text style={[styles.text, on && styles.textOn]}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Chiều cao một Segment: nút 32 + đệm 2 × 3. */
export const SEGMENT_H = 38;

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 18, padding: 3 },
  item: { minWidth: 64, height: 32, paddingHorizontal: 10, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: colors.accent },
  text: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  textOn: { color: colors.onAccent },
});
