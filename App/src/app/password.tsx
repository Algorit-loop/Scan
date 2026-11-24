import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorField, errorMessage, FormError } from '../auth/AuthScreen';
import { changePassword } from '../auth/session';
import { BackButton } from '../components/BackButton';
import { Button } from '../components/Button';
import { TextField, type TextFieldRef } from '../components/TextField';
import { colors, font } from '../theme';

/** Đổi mật khẩu: cần mật khẩu hiện tại. Máy này vẫn đăng nhập; các máy khác của tài khoản phải đăng nhập lại. Cần mạng. */
export default function PasswordScreen() {
  const insets = useSafeAreaInsets();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const newRef = useRef<TextFieldRef>(null);

  const fail = (message: string, f?: string) => {
    setError(message);
    setField(f);
  };
  const submit = async () => {
    if (busy) return;
    if (!currentPassword) return fail('Cần nhập mật khẩu hiện tại.', 'currentPassword');
    if (newPassword.length < 8) return fail('Mật khẩu mới cần ít nhất 8 ký tự.', 'newPassword');
    if (newPassword === currentPassword) return fail('Mật khẩu mới phải khác mật khẩu hiện tại.', 'newPassword');
    setBusy(true);
    setError(null);
    setField(undefined);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setDone(true);
    } catch (e) {
      fail(errorMessage(e), errorField(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => router.back()} label="Quay lại Cài đặt" />
        <Text style={styles.title} accessibilityRole="header">
          Đổi mật khẩu
        </Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <TextField
          label="Mật khẩu hiện tại"
          value={currentPassword}
          onChangeText={(v) => {
            setCurrentPassword(v);
            setDone(false);
          }}
          error={field === 'currentPassword' ? error : null}
          secure
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="next"
          onSubmitEditing={() => newRef.current?.focus()}
        />
        <TextField
          label="Mật khẩu mới (ít nhất 8 ký tự)"
          inputRef={newRef}
          value={newPassword}
          onChangeText={(v) => {
            setNewPassword(v);
            setDone(false);
          }}
          error={field === 'newPassword' ? error : null}
          secure
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <FormError message={field ? null : error} />
        {done && (
          <Text style={styles.done} accessibilityLiveRegion="polite">
            Đã đổi mật khẩu. Các máy khác đang đăng nhập tài khoản này sẽ phải đăng nhập lại.
          </Text>
        )}
        <Button label="Đổi mật khẩu" busy={busy} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { flex: 1, color: colors.text, fontSize: font.title, fontWeight: '700' },
  content: { paddingHorizontal: 24, paddingTop: 8, gap: 16 },
  done: { color: colors.success, fontSize: font.body, lineHeight: 26 },
});
