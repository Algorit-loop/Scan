import { Tabs } from 'expo-router/js-tabs';

import { TabIcon } from '../../components/TabIcon';
import { colors, font } from '../../theme';

/** Ba mục chính của app, chuyển bằng thanh dưới: Trang chủ, Lịch sử, Cài đặt. */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, borderTopWidth: 1, height: 84, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: font.small, fontWeight: '700' },
        tabBarAllowFontScaling: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Trang chủ', tabBarIcon: ({ color }) => <TabIcon name="home" color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'Lịch sử', tabBarIcon: ({ color }) => <TabIcon name="history" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Cài đặt', tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} /> }}
      />
    </Tabs>
  );
}
