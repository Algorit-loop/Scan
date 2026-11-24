import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreen, errorField, errorMessage, FormError } from '../auth/AuthScreen';
import { signUp } from '../auth/session';
import { Button } from '../components/Button';
import { TextField, type TextFieldRef } from '../components/TextField';
import { colors, font } from '../theme';

/** Đăng ký tài khoản mới: tên, email, mật khẩu (chưa cần xác minh email). Thành công là vào app luôn. */
export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  const emailRef = useRef<TextFieldRef>(null);
  const passwordRef = useRef<TextFieldRef>(null);

  const fail = (message: string, f?: string) => {
    setError(message);
    setField(f);
  };
  const submit = async () => {
    if (busy) return;
    // Kiểm tra nhanh trên máy để báo ngay; server vẫn kiểm tra lại.
    if (!name.trim()) return fail('Cần nhập tên.', 'name');
    if (!email.trim()) return fail('Cần nhập email.', 'email');
    if (password.length < 8) return fail('Mật khẩu cần ít nhất 8 ký tự.', 'password');
    setBusy(true);
    setError(null);
    setField(undefined);
    try {
      await signUp({ name, email, password });
    } catch (e) {
      fail(errorMessage(e), errorField(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen title="Đăng ký" subtitle="Tạo tài khoản để dùng Scan Trợ Giúp. Lịch sử quét vẫn chỉ lưu trên máy của bạn.">
      <TextField
        label="Tên của bạn"
        value={name}
        onChangeText={setName}
        error={field === 'name' ? error : null}
        autoCapitalize="words"
        textContentType="name"
        autoComplete="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <TextField
        label="Email"
        inputRef={emailRef}
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
        label="Mật khẩu (ít nhất 8 ký tự)"
        inputRef={passwordRef}
        value={password}
        onChangeText={setPassword}
        error={field === 'password' ? error : null}
        secure
        textContentType="newPassword"
        autoComplete="new-password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      <FormError message={field ? null : error} />
      <Button label="Đăng ký" busy={busy} onPress={submit} />
      <View style={styles.switch}>
        <Text style={styles.switchText}>Đã có tài khoản?</Text>
        <Link href="/login" replace style={styles.link} accessibilityRole="link">
          Đăng nhập
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
