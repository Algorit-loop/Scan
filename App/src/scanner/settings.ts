import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/** Tùy chọn của app (lưu trên máy). */
export type ScanSettings = {
  /** Cạnh dài khung gửi detect (px). docdetect_v3 vẫn tự thu về 256 để xử lý. */
  detectSide: 256 | 640;
  /** true: lọc qua Tracker; false: vẽ thẳng kết quả detect. */
  tracker: boolean;
  /**
   * Độ phân giải luồng camera: 2160 (4K, mặc định) hoặc 1080. Ảnh chụp lấy từ khung video nên 4K cho trang giấy rộng
   * ~1300-2000 px — mức chữ đủ lớn để nhận dạng chính xác; 1080p chỉ còn ~700 px, sai nhiều hơn hẳn.
   */
  cameraHeight: 1080 | 2160;
  /** Màn kết quả: vẽ khung bố cục (PP-DocLayout-S) lên ảnh. */
  showLayout: boolean;
  /** Màn kết quả: đọc xong một câu thì tự đọc câu tiếp. */
  continuous: boolean;
  /** Tốc độ giọng đọc (1 = bình thường). */
  speechRate: 0.8 | 1 | 1.2;
};

// v2: đổi mặc định camera sang 4K (bản v1 lưu sẵn 1080 trên máy đã cài).
const KEY = 'scan-settings-v2';
export const DEFAULT_SETTINGS: ScanSettings = {
  detectSide: 256,
  tracker: true,
  cameraHeight: 2160,
  showLayout: false,
  continuous: false,
  speechRate: 1,
};

export function useScanSettings(): [ScanSettings, (patch: Partial<ScanSettings>) => void] {
  const [settings, setSettings] = useState<ScanSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }))
      .catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<ScanSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  return [settings, update];
}
