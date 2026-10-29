import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { PermissionGate } from '../components/PermissionGate';
import { colors } from '../theme';

export default function RootLayout() {
  return (
    <PermissionGate>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 22, fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Tài liệu đã quét' }} />
        <Stack.Screen
          name="scan"
          options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
        />
        <Stack.Screen name="doc/[id]" options={{ title: 'Tài liệu' }} />
      </Stack>
    </PermissionGate>
  );
}
