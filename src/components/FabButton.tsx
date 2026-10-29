import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme';

type Props = {
  onPress: () => void;
  bottom: number;
  label: string;
};

/** Nút tròn lớn ở giữa, sát đáy màn hình — dễ tìm bằng tay. */
export function FabButton({ onPress, bottom, label }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.fab, { bottom }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={12}
    >
      <Text style={styles.plus} importantForAccessibility="no" accessibilityElementsHidden>
        +
      </Text>
    </Pressable>
  );
}

const SIZE = 84;

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    alignSelf: 'center',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.text,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  pressed: { transform: [{ scale: 0.94 }] },
  plus: { color: colors.onAccent, fontSize: 52, lineHeight: 58, fontWeight: '700' },
});
