import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreen, errorField, errorMessage, FormError } from '../auth/AuthScreen';
import { signIn } from '../auth/session';
import { Button } from '../components/Button';
import { TextField, type TextFieldRef } from '../components/TextField';
import { colors, font } from '../theme';

/** Đăng nhập bằng email + mật khẩu (cần mạng tới máy chủ). Thành công thì bộ điều hướng tự chuyển vào app. */
export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  const passwordRef = useRef<TextFieldRef>(null);

  const submit = async () => {
    if (busy) return;
    if (!email.trim()) return fail('Cần nhập email.', 'email');
    if (!password) return fail('Cần nhập mật khẩu.', 'password');
    setBusy(true);
    setError(null);
    setField(undefined);
    try {
      await signIn({ email, password });
    } catch (e) {
      fail(errorMessage(e), errorField(e));
    } finally {
      setBusy(false);
    }
  };
  const fail = (message: string, f?: string) => {
    setError(message);
    setField(f);
  };

  return (
    <AuthScreen title="Đăng nhập" subtitle="Scan Trợ Giúp — quét tài liệu rồi nghe đọc từng câu.">
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={field === 'email' ? error : null}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        label="Mật khẩu"
        inputRef={passwordRef}
        value={password}
        onChangeText={setPassword}
        error={field === 'password' ? error : null}
        secure
        textContentType="password"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <FormError message={field ? null : error} />
      <Button label="Đăng nhập" busy={busy} onPress={submit} />
      <View style={styles.switch}>
        <Text style={styles.switchText}>Chưa có tài khoản?</Text>
        <Link href="/register" replace style={styles.link} accessibilityRole="link">
          Đăng ký
        </Link>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56 },
  switchText: { color: colors.textMuted, fontSize: font.body },
  link: { color: colors.accent, fontSize: font.body, fontWeight: '700', paddingVertical: 14, paddingHorizontal: 6 },
});
