import { type ComponentRef, type Ref, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { colors, font } from '../theme';

/** Kiểu của ô nhập để giữ ref (chuyển con trỏ sang ô kế tiếp). */
export type TextFieldRef = ComponentRef<typeof TextInput>;

/**
 * Ô nhập có nhãn phía trên và dòng lỗi phía dưới. Ô mật khẩu (`secure`) có nút Hiện / Ẩn.
 * Nhãn + lỗi được gộp vào nhãn trợ năng của ô để VoiceOver / TalkBack đọc đủ khi chạm vào.
 */
export function TextField({
  label,
  error,
  secure = false,
  inputRef,
  ...input
}: {
  label: string;
  error?: string | null;
  secure?: boolean;
  inputRef?: Ref<TextFieldRef>;
} & Omit<TextInputProps, 'secureTextEntry' | 'style'>) {
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.box, focused && styles.boxFocused, !!error && styles.boxError]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secure && hidden}
          accessibilityLabel={error ? `${label}. Lỗi: ${error}` : label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...input}
        />
        {secure && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Hiện mật khẩu' : 'Ẩn mật khẩu'}
            hitSlop={8}
          >
            <Text style={styles.toggleText}>{hidden ? 'Hiện' : 'Ẩn'}</Text>
          </Pressable>
        )}
      </View>
      {!!error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  boxFocused: { borderColor: colors.accent },
  boxError: { borderColor: colors.danger },
  input: { flex: 1, color: colors.text, fontSize: font.body, paddingHorizontal: 14, paddingVertical: 12 },
  toggle: { minWidth: 64, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  toggleText: { color: colors.accent, fontSize: font.small, fontWeight: '700' },
  error: { color: colors.danger, fontSize: font.small },
});
