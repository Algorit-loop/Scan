import Constants from 'expo-constants';
import { router } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ServerSection } from '../../auth/AuthScreen';
import { signOut, useAuth } from '../../auth/session';
import { Button } from '../../components/Button';
import { Segment } from '../../components/Segment';
import { clearHistory, useHistory } from '../../history/store';
import { type ScanSettings, useScanSettings } from '../../scanner/settings';
import { colors, font } from '../../theme';

/** Cài đặt: tài khoản đang đăng nhập (sửa thông tin, đổi mật khẩu, đăng xuất), cách đọc, camera, máy chủ, dữ liệu trên máy. */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [settings, update] = useScanSettings();
  const { items } = useHistory();
  const [leaving, setLeaving] = useState(false);
  const user = auth.status === 'signedIn' ? auth.user : null;

  const confirmSignOut = () =>
    Alert.alert('Đăng xuất?', 'Lịch sử quét vẫn được giữ trên máy này và hiện lại khi bạn đăng nhập đúng tài khoản.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          await signOut();
        },
      },
    ]);

  const confirmClear = () =>
    Alert.alert('Xóa toàn bộ lịch sử?', `${items.length} tài liệu đã quét trên máy này sẽ bị xóa, không khôi phục được.`, [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Xóa hết', style: 'destructive', onPress: clearHistory },
    ]);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title} accessibilityRole="header">
        Cài đặt
      </Text>

      <Section title="Tài khoản">
        {user && (
          <View style={styles.account} accessible accessibilityLabel={`Đang đăng nhập: ${user.name}, ${user.email}`}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user.name.trim().charAt(0).toUpperCase() || '?'}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={1}>
                {user.name}
              </Text>
              <Text style={styles.email} numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          </View>
        )}
        <Button label="Sửa thông tin" kind="secondary" onPress={() => router.push('/profile')} />
        <Button label="Đổi mật khẩu" kind="secondary" onPress={() => router.push('/password')} />
        <Button label="Đăng xuất" kind="danger" busy={leaving} onPress={confirmSignOut} />
      </Section>

      <Section title="Đọc thành tiếng">
        <Option label="Cách đọc" note="Từng câu: đọc xong một câu thì dừng chờ bạn bấm. Liên tục: tự đọc tiếp tới hết.">
          <Segment
            label="Cách đọc"
            value={settings.continuous}
            options={[
              [false, 'Từng câu'],
              [true, 'Liên tục'],
            ]}
            onChange={(continuous) => update({ continuous })}
          />
        </Option>
        <Option label="Tốc độ đọc">
          <Segment<ScanSettings['speechRate']>
            label="Tốc độ đọc"
            value={settings.speechRate}
            options={[
              [0.8, 'Chậm'],
              [1, 'Vừa'],
              [1.2, 'Nhanh'],
            ]}
            onChange={(speechRate) => update({ speechRate })}
          />
        </Option>
      </Section>

      <Section title="Quét">
        <Option label="Độ phân giải camera" note="4K cho chữ nét hơn nên nhận dạng chính xác hơn. Chọn 1080p nếu máy bị giật khi quét.">
          <Segment<ScanSettings['cameraHeight']>
            label="Độ phân giải camera"
            value={settings.cameraHeight}
            options={[
              [2160, '4K'],
              [1080, '1080p'],
            ]}
            onChange={(cameraHeight) => update({ cameraHeight })}
          />
        </Option>
        <Option label="Khung bố cục trên ảnh kết quả">
          <Segment
            label="Khung bố cục"
            value={settings.showLayout}
            options={[
              [false, 'Ẩn'],
              [true, 'Hiện'],
            ]}
            onChange={(showLayout) => update({ showLayout })}
          />
        </Option>
      </Section>

      <Section title="Dữ liệu trên máy">
        <Text style={styles.note}>
          Ảnh quét, nội dung đã nhận dạng và lịch sử chỉ lưu trên điện thoại này, không gửi lên máy chủ. Hiện có {items.length} tài liệu
          trong lịch sử.
        </Text>
        <Button label="Xóa toàn bộ lịch sử" kind="danger" disabled={!items.length} onPress={confirmClear} />
      </Section>

      <Section title="Kết nối">
        <Text style={styles.note}>Máy chủ chỉ dùng cho đăng nhập, đăng ký và đổi thông tin tài khoản.</Text>
        <ServerSection />
      </Section>

      <Text style={styles.version}>Scan Trợ Giúp {Constants.expoConfig?.version ?? ''}</Text>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Option({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <View style={styles.option}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionControl}>{children}</View>
      {!!note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 24, paddingBottom: 32, gap: 28 },
  title: { color: colors.text, fontSize: font.huge, fontWeight: '800' },
  section: { gap: 12 },
  sectionTitle: { color: colors.accent, fontSize: font.body, fontWeight: '800' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.onAccent, fontSize: font.title, fontWeight: '800' },
  name: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  email: { color: colors.textMuted, fontSize: font.small, marginTop: 2 },
  option: { gap: 8 },
  optionLabel: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  optionControl: { alignItems: 'flex-start' },
  note: { color: colors.textMuted, fontSize: font.small, lineHeight: 21 },
  version: { color: colors.textMuted, fontSize: font.small, textAlign: 'center' },
});
