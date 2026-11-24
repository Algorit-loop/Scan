import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;
const SETTLE = { duration: 180 };

/**
 * Khung xem phóng to được: chụm 2 ngón để phóng/thu quanh điểm giữa hai ngón, kéo 1 ngón khi đã phóng,
 * chạm 2 lần để phóng 2,5× tại chỗ chạm hoặc trở về. Con (ảnh + khung bố cục) phóng cùng nhau.
 * Khi chưa phóng, kéo 1 ngón bị tắt để ScrollView bên ngoài cuộn bình thường (onZoomChange báo để tắt cuộn khi phóng).
 */
export function ZoomableView({
  width,
  height,
  children,
  onZoomChange,
}: {
  width: number;
  height: number;
  children: ReactNode;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ s: 1, x: 0, y: 0, fx: 0, fy: 0 });
  const zoomed = useSharedValue(false);

  const setZoomed = (z: boolean) => {
    'worklet';
    if (zoomed.value === z) return;
    zoomed.value = z;
    if (onZoomChange) scheduleOnRN(onZoomChange, z);
  };

  /** Dịch tối đa để ảnh đã phóng vẫn phủ kín khung (không lộ nền). */
  const clampT = (t: number, s: number, size: number) => {
    'worklet';
    const m = ((s - 1) * size) / 2;
    return Math.min(m, Math.max(-m, t));
  };

  const settle = () => {
    'worklet';
    const s = Math.min(MAX_SCALE, Math.max(1, scale.value));
    scale.value = withTiming(s, SETTLE);
    tx.value = withTiming(clampT(tx.value, s, width), SETTLE);
    ty.value = withTiming(clampT(ty.value, s, height), SETTLE);
    setZoomed(s > 1.01);
  };

  const pinch = usePinchGesture({
    onActivate: (e) => {
      'worklet';
      start.value = { s: scale.value, x: tx.value, y: ty.value, fx: e.focalX - width / 2, fy: e.focalY - height / 2 };
    },
    onUpdate: (e) => {
      'worklet';
      const st = start.value;
      const s = Math.min(MAX_SCALE * 1.2, Math.max(0.7, st.s * e.scale));
      // Giữ điểm nội dung đang nằm dưới hai ngón (lúc bắt đầu) đi theo tâm hai ngón hiện tại.
      const fx = e.focalX - width / 2;
      const fy = e.focalY - height / 2;
      scale.value = s;
      tx.value = fx - ((st.fx - st.x) * s) / st.s;
      ty.value = fy - ((st.fy - st.y) * s) / st.s;
    },
    onDeactivate: () => {
      'worklet';
      settle();
    },
  });

  const pan = usePanGesture({
    enabled: zoomed,
    maxPointers: 1,
    onActivate: () => {
      'worklet';
      start.value = { s: scale.value, x: tx.value, y: ty.value, fx: 0, fy: 0 };
    },
    onUpdate: (e) => {
      'worklet';
      tx.value = start.value.x + e.translationX;
      ty.value = start.value.y + e.translationY;
    },
    onDeactivate: () => {
      'worklet';
      settle();
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: (e) => {
      'worklet';
      if (scale.value > 1.01) {
        scale.value = withTiming(1, SETTLE);
        tx.value = withTiming(0, SETTLE);
        ty.value = withTiming(0, SETTLE);
        setZoomed(false);
        return;
      }
      const s = DOUBLE_TAP_SCALE;
      const fx = e.x - width / 2;
      const fy = e.y - height / 2;
      scale.value = withTiming(s, SETTLE);
      tx.value = withTiming(clampT(fx - fx * s, s, width), SETTLE);
      ty.value = withTiming(clampT(fy - fy * s, s, height), SETTLE);
      setZoomed(true);
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.frame, { width, height }]} collapsable={false}>
        <Animated.View style={[StyleSheet.absoluteFill, style]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
});
