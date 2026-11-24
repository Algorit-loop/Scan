import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { restoreSession, useAuth } from '../auth/session';
import { loadHistory } from '../history/store';
import { LayoutEngine } from '../layout/LayoutEngine';
import { OcrEngine } from '../ocr/OcrEngine';
import { colors } from '../theme';

export default function RootLayout() {
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.user.id : null;

  // Mở app: khôi phục phiên đăng nhập đã lưu trên máy (không cần mạng).
  useEffect(() => {
    restoreSession();
  }, []);
  // Lịch sử nằm trên máy, mỗi tài khoản một thư mục: nạp lại khi đổi người dùng.
  useEffect(() => {
    if (auth.status !== 'loading') loadHistory(userId);
  }, [auth.status, userId]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      {/*
        Hai engine chạy trong WebView ẩn: tải + nạp sẵn ngay khi mở app, sống suốt vòng đời app.
        Chúng PHẢI luôn nằm trong cửa sổ: iOS cho tiến trình của WKWebView "không hiển thị" (không thuộc cửa sổ nào)
        ngủ sau một khoảnh khắc — việc ngắn (bố cục S ~0,1 s) kịp xong, việc dài vài giây (nhận dạng chữ, model lớn)
        bị đóng băng giữa chừng và không bao giờ trả kết quả. Vì vậy các màn bên dưới KHÔNG được là fullScreenModal:
        modal toàn màn hình gỡ mọi thứ bên dưới (kể cả gốc app chứa hai WebView này) khỏi cửa sổ. Màn kiểu thường
        (card) chỉ đổi nội dung bên trong bộ điều hướng, gốc app vẫn ở trong cửa sổ.
      */}
      <LayoutEngine />
      <OcrEngine />
      {auth.status === 'loading' ? (
        <View style={styles.loading} accessibilityLabel="Đang mở ứng dụng">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          {/* Đã đăng nhập: ba mục chính (Trang chủ / Lịch sử / Cài đặt) + các màn mở chồng lên. */}
          <Stack.Protected guard={auth.status === 'signedIn'}>
            <Stack.Screen name="(tabs)" />
            {/* Không vuốt cạnh để quay lại: màn quét kéo / chạm trên camera, màn kết quả cuộn + phóng ảnh; dùng nút. */}
            <Stack.Screen name="scan" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="result" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="profile" />
            <Stack.Screen name="password" />
          </Stack.Protected>
          {/* Chưa đăng nhập: chỉ vào được hai màn này. */}
          <Stack.Protected guard={auth.status === 'signedOut'}>
            <Stack.Screen name="login" options={{ animation: 'fade' }} />
            <Stack.Screen name="register" options={{ animation: 'fade' }} />
          </Stack.Protected>
        </Stack>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
