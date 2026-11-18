import { File, Paths } from 'expo-file-system';

export type Scan = {
  uri: string;
  width: number;
  height: number;
  /** false: không thấy tài liệu, ảnh là khung hình gốc. */
  flattened: boolean;
};

/** Chỉ giữ ảnh vừa chụp (trong cache), ảnh cũ bị xóa khi có ảnh mới. */
let last: Scan | null = null;

export async function saveScan(base64Jpeg: string, info: Omit<Scan, 'uri'>): Promise<Scan> {
  const file = new File(Paths.cache, `scan-${Date.now()}.jpg`);
  await file.write(base64Jpeg, { encoding: 'base64' });
  if (last) {
    try {
      new File(last.uri).delete();
    } catch {
      // ảnh cũ đã bị hệ thống dọn
    }
  }
  last = { uri: file.uri, ...info };
  return last;
}

export function getLastScan(): Scan | null {
  return last;
}
