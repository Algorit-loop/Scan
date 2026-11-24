import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { StyleSheet } from 'react-native';

/**
 * Chuẩn bị trang cho một "engine" chạy trong WebView ẩn (bộ phân vùng bố cục, bộ nhận dạng chữ):
 *  - tải các asset (wasm, model, dữ liệu) về máy — Expo Go: từ Metro vào cache, chạy nền;
 *  - chép chúng vào <cache>/<dirName>/ cạnh trang, vì WebView (iOS) chỉ đọc được file trong thư mục được cấp quyền
 *    (allowingReadAccessToURL = cache của app), còn asset lại nằm chỗ khác (Expo Go: Library/Caches chung; bản
 *    release: trong gói app). Tên file có hash nội dung nên đổi model là chép lại, bản cũ bị xóa;
 *  - ghi trang (thay `__ASSETS__` bằng bảng tên -> đường dẫn file://) ra index.html.
 * Trang tự đọc asset và ảnh bằng XHR; qua cầu nối React Native <-> WebView chỉ có message nhỏ.
 * Trả đường dẫn file:// của trang.
 */
export async function writeEnginePage(dirName: string, html: string, modules: Record<string, number>): Promise<string> {
  const names = Object.keys(modules);
  const assets = await Asset.loadAsync(names.map((n) => modules[n]));
  const dir = new Directory(Paths.cache, dirName);
  dir.create({ intermediates: true, idempotent: true });
  const urls: Record<string, string> = {};
  const keep = new Set<string>(['index.html']);
  for (let i = 0; i < names.length; i++) {
    const src = assets[i].localUri;
    if (!src) throw new Error(`không tải được ${names[i]}`);
    const from = new File(src);
    const name = `${assets[i].hash ?? names[i]}.${assets[i].type}`;
    const to = new File(dir, name);
    if (!to.exists || to.size !== from.size) {
      if (to.exists) to.delete();
      await from.copy(to);
    }
    keep.add(name);
    urls[names[i]] = to.uri;
  }
  for (const f of dir.list()) if (f instanceof File && !keep.has(f.name)) f.delete();
  const file = new File(dir, 'index.html');
  file.write(html.replace('__ASSETS__', () => JSON.stringify(urls)));
  return file.uri;
}

export const engineStyles = StyleSheet.create({
  // Không thấy được nhưng vẫn là một view thật trong cửa sổ (1 px, gần trong suốt) để iOS không cho tiến trình web
  // ngủ — xem ghi chú ở app/_layout.tsx. Kích thước 0 có thể khiến WebView không nạp trang trên vài máy.
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0.01, left: 0, top: 0 },
});

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
