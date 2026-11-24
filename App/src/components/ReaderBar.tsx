import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors, font } from '../theme';

type Kind = 'previous' | 'replay' | 'next';

const ICONS: Record<Kind, string[]> = {
  // Tam giác chỉ sang trái + vạch đứng.
  previous: ['M19 5v14l-10-7z', 'M6 5v14'],
  // Mũi tên vòng ngược chiều kim đồng hồ.
  replay: ['M4.5 12a7.5 7.5 0 1 0 2.4-5.5', 'M4 4.5v4.2h4.2'],
  next: ['M5 5v14l10-7z', 'M18 5v14'],
};

function Icon({ kind, color }: { kind: Kind; color: string }) {
  const filled = kind !== 'replay';
  return (
    <Svg width={34} height={34} viewBox="0 0 24 24" fill="none">
      {ICONS[kind].map((d, i) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={filled && i === 0 ? color : 'none'}
        />
      ))}
    </Svg>
  );
}

function Button({
  kind,
  label,
  hint,
  primary,
  disabled,
  onPress,
}: {
  kind: Kind;
  label: string;
  hint: string;
  primary?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const color = primary ? colors.onAccent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, primary && styles.primary, (pressed || disabled) && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
    >
      <Icon kind={kind} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Thanh điều khiển đọc, cố định ở đáy màn hình: trái = câu trước, giữa = đọc lại, phải = câu sau.
 * Nút to (cao 76), cách nhau rõ, có nhãn chữ + nhãn cho VoiceOver / TalkBack.
 */
export function ReaderBar({
  disabled,
  onPrevious,
  onReplay,
  onNext,
}: {
  disabled: boolean;
  onPrevious: () => void;
  onReplay: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.bar}>
      <Button kind="previous" label="Câu trước" hint="Đọc câu đứng trước" disabled={disabled} onPress={onPrevious} />
      <Button kind="replay" label="Đọc lại" hint="Đọc lại câu hiện tại" primary disabled={disabled} onPress={onReplay} />
      <Button kind="next" label="Câu sau" hint="Đọc câu tiếp theo" disabled={disabled} onPress={onNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    height: 76,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  primary: { backgroundColor: colors.accent },
  label: { fontSize: font.small, fontWeight: '700' },
  pressed: { opacity: 0.5 },
});
