import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

/** Tùy chọn thử nghiệm trên màn quét (lưu trên máy). */
export type ScanSettings = {
  /** Cạnh dài khung gửi detect (px). docdetect_v3 vẫn tự thu về 256 để xử lý. */
  detectSide: 256 | 640;
  /** true: lọc qua Tracker; false: vẽ thẳng kết quả detect. */
  tracker: boolean;
};

const KEY = 'scan-settings-v1';
export const DEFAULT_SETTINGS: ScanSettings = { detectSide: 256, tracker: true };

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
