import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '../theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="result" options={{ animation: 'fade' }} />
      </Stack>
    </>
  );
}
