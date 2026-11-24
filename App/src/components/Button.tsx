import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, font } from '../theme';

type Kind = 'primary' | 'secondary' | 'danger';

/** Nút lớn (cao 56), tương phản cao; `busy` hiện vòng xoay và chặn bấm. */
export function Button({
  label,
  onPress,
  kind = 'primary',
  busy = false,
  disabled = false,
  hint,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: Kind;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  const textColor = kind === 'primary' ? colors.onAccent : kind === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [styles.button, styles[kind], (pressed || off) && styles.dim, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy }}
    >
      {busy ? <ActivityIndicator color={textColor} /> : <Text style={[styles.label, { color: textColor }]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 56, borderRadius: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderColor: colors.border },
  danger: { backgroundColor: 'transparent', borderColor: colors.danger },
  label: { fontSize: font.body, fontWeight: '700', textAlign: 'center' },
  dim: { opacity: 0.55 },
});
