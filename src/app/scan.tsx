import { CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addPhoto } from '../photos/photos';
import { colors, font, MIN_TOUCH } from '../theme';

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = async () => {
    if (busy || !ready || !camera.current) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9 });
      addPhoto(photo.uri);
      router.back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="back"
        onCameraReady={() => setReady(true)}
        onMountError={(e) => setError(e.message)}
      />

      {error && (
        <View style={[styles.error, { top: insets.top + 80 }]}>
          <Text style={styles.errorText}>Lỗi camera: {error}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.close, { top: insets.top + 12 }, pressed && styles.pressed]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Đóng, quay lại danh sách"
        hitSlop={8}
      >
        <Text style={styles.closeText}>Đóng</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.shutter,
          { bottom: Math.max(insets.bottom, 16) + 24 },
          pressed && styles.pressed,
        ]}
        onPress={capture}
        disabled={busy || !ready}
        accessibilityRole="button"
        accessibilityLabel="Chụp ảnh"
      >
        {busy ? <ActivityIndicator color={colors.onAccent} size="large" /> : <View style={styles.shutterInner} />}
      </Pressable>
    </View>
  );
}

const SHUTTER = 84;
const INNER = SHUTTER - 28;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  close: {
    position: 'absolute',
    left: 16,
    minHeight: MIN_TOUCH,
    minWidth: 96,
    paddingHorizontal: 18,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 2,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.text, fontSize: font.body, fontWeight: '700' },
  shutter: {
    position: 'absolute',
    alignSelf: 'center',
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: INNER, height: INNER, borderRadius: INNER / 2, borderWidth: 3, borderColor: colors.onAccent },
  pressed: { opacity: 0.6 },
  error: { position: 'absolute', left: 16, right: 16, padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.8)' },
  errorText: { color: colors.danger, fontSize: font.body, textAlign: 'center' },
});
