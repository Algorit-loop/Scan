import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LayoutEngine } from '../layout/LayoutEngine';
import { OcrEngine } from '../ocr/OcrEngine';
import { colors } from '../theme';

export default function RootLayout() {
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
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        {/* Không vuốt cạnh để quay lại: màn quét kéo / chạm trên camera, màn kết quả cuộn + phóng ảnh; dùng nút. */}
        <Stack.Screen name="scan" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="result" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
