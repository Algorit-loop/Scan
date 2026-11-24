import { type ReactNode, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { colors, font } from '../theme';
import { api, ApiError, defaultServerUrl, getServerUrl, normalizeServerUrl, setServerUrl } from './api';

/** Khung chung của màn Đăng nhập / Đăng ký: tiêu đề, nội dung cuộn được và không bị bàn phím che, mục máy chủ ở cuối. */
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        {children}
        <ServerSection />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Dòng lỗi chung của biểu mẫu (lỗi mạng, sai mật khẩu...). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text style={styles.formError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      {message}
    </Text>
  );
}

/** Thông báo để hiện cho người dùng từ một lỗi bất kỳ. */
export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Có lỗi không mong muốn. Hãy thử lại.';
}

/** Trường nhập liệu mà server báo sai (nếu có). */
export function errorField(e: unknown): string | undefined {
  return e instanceof ApiError ? e.field : undefined;
}

/**
 * Địa chỉ máy chủ: mặc định tự suy ra (máy tính đang chạy Expo, cổng 4000). Mở ra để xem, kiểm tra kết nối, hoặc nhập
 * địa chỉ khác. Dùng ở màn đăng nhập (chưa vào được Cài đặt) và trong Cài đặt.
 */
export function ServerSection({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getServerUrl().then((u) => {
      setUrl(u);
      setDraft(u);
    });
  }, []);

  const check = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await api.health();
      setStatus({ ok: true, text: 'Kết nối được máy chủ.' });
    } catch (e) {
      setStatus({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const save = async (value: string | null) => {
    const next = value == null ? null : normalizeServerUrl(value);
    if (value != null && !next) {
      setStatus({ ok: false, text: 'Địa chỉ không hợp lệ. Ví dụ: 192.168.1.5 hoặc https://ten-mien.vn' });
      return;
    }
    const used = await setServerUrl(next === defaultServerUrl() ? null : next);
    setUrl(used);
    setDraft(used);
    await check();
  };

  return (
    <View style={styles.server}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={styles.serverHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Máy chủ: ${url}`}
        accessibilityHint={open ? 'Chạm hai lần để thu gọn' : 'Chạm hai lần để kiểm tra hoặc đổi địa chỉ máy chủ'}
      >
        <Text style={styles.serverTitle}>Máy chủ</Text>
        <Text style={styles.serverUrl} numberOfLines={1}>
          {url}
        </Text>
        <Text style={styles.serverToggle}>{open ? 'Thu gọn' : 'Đổi'}</Text>
      </Pressable>
      {open && (
        <View style={styles.serverBody}>
          <Text style={styles.note}>
            Đăng nhập và đăng ký cần mạng tới máy chủ. Khi chạy thử bằng Expo Go, máy chủ là máy tính đang chạy Expo (lệnh
            Server\run.ps1), điện thoại và máy tính phải cùng mạng Wi-Fi.
          </Text>
          <TextField
            label="Địa chỉ máy chủ"
            value={draft}
            onChangeText={setDraft}
            keyboardType="url"
            placeholder={defaultServerUrl()}
            returnKeyType="done"
            onSubmitEditing={() => save(draft)}
          />
          <View style={styles.row}>
            <Button label="Lưu và kiểm tra" kind="secondary" busy={busy} onPress={() => save(draft)} style={styles.grow} />
            <Button label="Mặc định" kind="secondary" disabled={busy} onPress={() => save(null)} />
          </View>
          {status && (
            <Text style={[styles.note, status.ok ? styles.ok : styles.bad]} accessibilityLiveRegion="polite">
              {status.text}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, gap: 16 },
  head: { gap: 6, marginBottom: 8 },
  title: { color: colors.text, fontSize: font.huge, fontWeight: '800' },
  subtitle: { color: colors.textMuted, fontSize: font.body, lineHeight: 26 },
  formError: {
    color: colors.danger,
    fontSize: font.body,
    lineHeight: 26,
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: 14,
    padding: 12,
  },
  server: { marginTop: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  serverHead: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  serverTitle: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  serverUrl: { flex: 1, color: colors.textMuted, fontSize: font.small },
  serverToggle: { color: colors.accent, fontSize: font.small, fontWeight: '700' },
  serverBody: { padding: 14, paddingTop: 0, gap: 12 },
  note: { color: colors.textMuted, fontSize: font.small, lineHeight: 21 },
  ok: { color: colors.success },
  bad: { color: colors.danger },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
