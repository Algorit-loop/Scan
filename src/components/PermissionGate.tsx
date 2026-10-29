import { useCameraPermissions } from 'expo-camera';
import { type ReactNode, useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { initVoice, say } from '../feedback/announcer';
import { MESSAGES } from '../guidance/messages.vi';
import { colors, font, MIN_TOUCH } from '../theme';

/**
 * Chặn toàn bộ app cho tới khi có quyền camera.
 * Lần đầu mở app sẽ tự hiện hộp thoại xin quyền của hệ điều hành.
 */
export function PermissionGate({ children }: { children: ReactNode }) {
  const [permission, requestPermission] = useCameraPermissions();
  const asked = useRef(false);

  useEffect(() => {
    initVoice();
  }, []);

  useEffect(() => {
    if (!permission || permission.granted || asked.current) return;
    asked.current = true;
    if (permission.canAskAgain) requestPermission();
    else say(MESSAGES.permissionExplain, { important: true });
  }, [permission, requestPermission]);

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Đang tải" />
      </View>
    );
  }

  if (permission.granted) return <>{children}</>;

  const blocked = !permission.canAskAgain;
  return (
    <View style={styles.center}>
      <Text style={styles.title} accessibilityRole="header">
        Cần quyền camera
      </Text>
      <Text style={styles.body}>
        {blocked
          ? 'Bạn đã từ chối quyền camera. Hãy mở Cài đặt và bật quyền Camera cho ứng dụng.'
          : 'Ứng dụng dùng camera để quét tài liệu và hướng dẫn bạn căn chỉnh bằng giọng nói.'}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={blocked ? 'Mở cài đặt' : 'Cho phép camera'}
        onPress={() => (blocked ? Linking.openSettings() : requestPermission())}
      >
        <Text style={styles.buttonText}>{blocked ? 'Mở Cài đặt' : 'Cho phép camera'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 20,
  },
  title: { color: colors.text, fontSize: font.huge, fontWeight: '700', textAlign: 'center' },
  body: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 28 },
  button: {
    minHeight: MIN_TOUCH + 16,
    minWidth: 260,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pressed: { opacity: 0.7 },
  buttonText: { color: colors.onAccent, fontSize: font.title, fontWeight: '700' },
});
