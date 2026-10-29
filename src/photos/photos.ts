import { useSyncExternalStore } from 'react';

export type Photo = {
  id: string;
  uri: string;
  createdAt: number;
};

/**
 * Danh sách ảnh tạm trong bộ nhớ (mất khi tắt app).
 * Lưu trữ lâu dài và danh sách ảnh đã detect từ server sẽ làm sau — xem src/_disabled/storage.
 */
let photos: Photo[] = [];
const listeners = new Set<() => void>();

export function addPhoto(uri: string): Photo {
  const photo: Photo = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uri, createdAt: Date.now() };
  photos = [photo, ...photos];
  listeners.forEach((l) => l());
  return photo;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function usePhotos(): Photo[] {
  return useSyncExternalStore(subscribe, () => photos);
}
