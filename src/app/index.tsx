import { Image } from 'expo-image';
import { router } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FabButton } from '../components/FabButton';
import { usePhotos } from '../photos/photos';
import { colors, font } from '../theme';

const COLUMNS = 2;

export default function PhotoListScreen() {
  const photos = usePhotos();
  const insets = useSafeAreaInsets();
  const fabBottom = Math.max(insets.bottom, 16) + 8;

  return (
    <View style={styles.container}>
      <FlatList
        data={photos}
        keyExtractor={(p) => p.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.column}
        contentContainerStyle={[styles.list, { paddingBottom: fabBottom + 110 }, photos.length === 0 && styles.grow]}
        renderItem={({ item, index }) => (
          <Image
            source={{ uri: item.uri }}
            style={styles.photo}
            contentFit="cover"
            accessible
            accessibilityLabel={`Ảnh ${photos.length - index}`}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Chưa có ảnh nào</Text>
            <Text style={styles.emptyBody}>Chạm nút tròn màu vàng ở giữa, cuối màn hình để mở camera.</Text>
          </View>
        }
      />
      <FabButton onPress={() => router.push('/scan')} bottom={fabBottom} label="Mở camera" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: 8 },
  grow: { flexGrow: 1 },
  column: { gap: 8, marginBottom: 8 },
  photo: { flex: 1 / COLUMNS, aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: colors.surface },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { color: colors.text, fontSize: font.title, fontWeight: '700', textAlign: 'center' },
  emptyBody: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 28 },
});
