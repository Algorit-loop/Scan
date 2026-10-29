import { Alert } from 'react-native';

import { say } from '../feedback/announcer';
import { removeScan, type Scan } from '../storage/scans';

export function confirmDelete(scan: Scan, onDeleted?: () => void) {
  Alert.alert(`Xóa tài liệu ${scan.number}?`, 'Ảnh sẽ bị xóa vĩnh viễn.', [
    { text: 'Hủy', style: 'cancel' },
    {
      text: 'Xóa',
      style: 'destructive',
      onPress: async () => {
        await removeScan(scan.id);
        say(`Đã xóa tài liệu ${scan.number}`, { important: true });
        onDeleted?.();
      },
    },
  ]);
}
