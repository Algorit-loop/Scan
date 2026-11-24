import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { errorField, errorMessage, FormError } from '../auth/AuthScreen';
import { deleteAccount, updateProfile, useAuth } from '../auth/session';
import { BackButton } from '../components/BackButton';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { colors, font } from '../theme';

/** Sửa thông tin tài khoản: tên, email (đổi email cần mật khẩu hiện tại); cuối trang: xóa tài khoản. Cần mạng. */
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const user = auth.status === 'signedIn' ? auth.user : null;
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== (user?.email ?? '');
  const changed = name.trim() !== (user?.name ?? '') || emailChanged;

  const fail = (message: string, f?: string) => {
    setError(message);
    setField(f);
  };
  const save = async () => {
    if (busy || !changed) return;
    if (!name.trim()) return fail('Cần nhập tên.', 'name');
    if (!email.trim()) return fail('Cần nhập email.', 'email');
    if (emailChanged && !currentPassword) return fail('Đổi email cần nhập mật khẩu hiện tại.', 'currentPassword');
    setBusy(true);
    setError(null);
    setField(undefined);
    setSaved(false);
    try {
      await updateProfile({ name, ...(emailChanged ? { email, currentPassword } : {}) });
      setCurrentPassword('');
      setSaved(true);
    } catch (e) {
      fail(errorMessage(e), errorField(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!deletePassword) return setDeleteError('Nhập mật khẩu để xác nhận xóa tài khoản.');
    Alert.alert('Xóa tài khoản?', 'Tài khoản sẽ bị xóa khỏi máy chủ và không khôi phục được. Lịch sử quét trên máy này không bị xóa.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa tài khoản',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setDeleteError(null);
          try {
            await deleteAccount(deletePassword); // xong là bị đưa về màn đăng nhập
          } catch (e) {
            setDeleteError(errorMessage(e));
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => router.back()} label="Quay lại Cài đặt" />
        <Text style={styles.title} accessibilityRole="header">
          Thông tin tài khoản
        </Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <TextField
          label="Tên của bạn"
          value={name}
          onChangeText={(v) => {
            setName(v);
            setSaved(false);
          }}
          error={field === 'name' ? error : null}
          autoCapitalize="words"
          textContentType="name"
        />
        <TextField
          label="Email (dùng để đăng nhập)"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setSaved(false);
          }}
          error={field === 'email' ? error : null}
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        {emailChanged && (
          <TextField
            label="Mật khẩu hiện tại (để xác nhận đổi email)"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            error={field === 'currentPassword' ? error : null}
            secure
            textContentType="password"
          />
        )}
        <FormError message={field ? null : error} />
        {saved && (
          <Text style={styles.saved} accessibilityLiveRegion="polite">
            Đã lưu thông tin.
          </Text>
        )}
        <Button label="Lưu thay đổi" busy={busy} disabled={!changed} onPress={save} />

        <View style={styles.danger}>
          <Text style={styles.dangerTitle} accessibilityRole="header">
            Xóa tài khoản
          </Text>
          <Text style={styles.note}>Xóa hẳn tài khoản khỏi máy chủ. Lịch sử quét trên điện thoại này không bị xóa.</Text>
          <TextField
            label="Mật khẩu"
            value={deletePassword}
            onChangeText={(v) => {
              setDeletePassword(v);
              setDeleteError(null);
            }}
            error={deleteError}
            secure
            textContentType="password"
          />
          <Button label="Xóa tài khoản" kind="danger" busy={deleting} onPress={confirmDelete} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  title: { flex: 1, color: colors.text, fontSize: font.title, fontWeight: '700' },
  content: { paddingHorizontal: 24, paddingTop: 8, gap: 16 },
  saved: { color: colors.success, fontSize: font.body },
  danger: { marginTop: 32, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 24 },
  dangerTitle: { color: colors.danger, fontSize: font.body, fontWeight: '800' },
  note: { color: colors.textMuted, fontSize: font.small, lineHeight: 21 },
});
