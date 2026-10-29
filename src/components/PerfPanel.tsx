import { Platform, StyleSheet, Text, View } from 'react-native';

import type { ServerStatus } from '../server/serverClient';
import type { CameraMode, FrameStats } from '../scan/types';

type NumKey = 'grab' | 'rtt' | 'server' | 'local' | 'total' | 'interval';

function avg(list: FrameStats[], key: NumKey): number {
  const vals = list.map((f) => f[key]).filter((v) => v > 0);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

const SERVER_LABEL: Record<ServerStatus, string> = {
  online: 'đã kết nối',
  connecting: 'đang kết nối…',
  offline: 'ngoại tuyến',
};

type Props = {
  mode: CameraMode;
  serverStatus: ServerStatus;
  stats: FrameStats[];
  top: number;
};

/** Bảng đo thời gian trung bình các khung gần nhất — chỉ để phát triển, ẩn khỏi trình đọc màn hình. */
export function PerfPanel({ mode, serverStatus, stats, top }: Props) {
  const fps = avg(stats, 'interval') ? (1000 / avg(stats, 'interval')).toFixed(1) : '-';
  const lastFrame = stats[stats.length - 1];
  return (
    <View
      pointerEvents="none"
      style={[styles.box, { top }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={styles.text}>
        {`camera  ${mode === 'web' ? 'WebView' : 'chụp ảnh'}\n` +
          `server  ${SERVER_LABEL[serverStatus]}\n` +
          (lastFrame
            ? `TB ${stats.length} khung (ms)\n` +
              `lấy khung ${avg(stats, 'grab')}\n` +
              `mạng+srv  ${avg(stats, 'rtt')}\n` +
              `  srv     ${avg(stats, 'server')}\n` +
              `trên máy  ${avg(stats, 'local')}\n` +
              `tổng      ${avg(stats, 'total')}\n` +
              `≈ ${fps} khung/s\n` +
              `${lastFrame.size} ${lastFrame.source}`
            : 'chưa có khung')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    right: 12,
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  text: { color: '#7CFC00', fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
