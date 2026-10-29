import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useSyncExternalStore } from 'react';

const INDEX_KEY = 'scans:v1';
const THUMB_WIDTH = 200;

/**
 * Bản ghi lưu trong AsyncStorage. Chỉ lưu tên file, không lưu đường dẫn tuyệt đối,
 * vì thư mục Documents trên iOS có thể đổi đường dẫn sau khi cập nhật app.
 */
type StoredScan = {
  id: string;
  number: number;
  createdAt: number;
  width: number;
  height: number;
  file: string;
  thumbFile: string;
};

export type Scan = StoredScan & {
  uri: string;
  thumbUri: string;
};

export type CropRect = { originX: number; originY: number; width: number; height: number };

const scansDir = () => new Directory(Paths.document, 'scans');

function hydrate(s: StoredScan): Scan {
  return {
    ...s,
    uri: new File(scansDir(), s.file).uri,
    thumbUri: new File(scansDir(), s.thumbFile).uri,
  };
}

// --- Store nhỏ trong bộ nhớ, để danh sách tự cập nhật sau khi quét ---

let items: StoredScan[] = [];
let snapshot: Scan[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  snapshot = items.map(hydrate);
  listeners.forEach((l) => l());
}

async function persist() {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items));
}

export function loadScans(): Promise<void> {
  if (loaded) return Promise.resolve();
  loading ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(INDEX_KEY);
      const parsed: StoredScan[] = raw ? JSON.parse(raw) : [];
      // Bỏ các bản ghi mà file ảnh đã mất.
      items = parsed.filter((s) => new File(scansDir(), s.file).exists);
      if (items.length !== parsed.length) await persist();
    } catch {
      items = [];
    }
    loaded = true;
    emit();
  })();
  return loading;
}

function deleteFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // ignore
  }
}

async function renderTo(
  sourceUri: string,
  dest: File,
  edit: (ctx: ReturnType<typeof ImageManipulator.manipulate>) => void,
  compress: number,
) {
  const ctx = ImageManipulator.manipulate(sourceUri);
  try {
    edit(ctx);
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress });
    ref.release();
    await new File(out.uri).move(dest, { overwrite: true });
    return { width: out.width, height: out.height };
  } finally {
    ctx.release();
  }
}

/** Crop (nếu có) ảnh vừa chụp, lưu vào Documents/scans kèm thumbnail, rồi thêm vào danh sách. */
export async function addScan(photoUri: string, crop?: CropRect): Promise<Scan> {
  await loadScans();
  const dir = scansDir();
  dir.create({ intermediates: true, idempotent: true });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const file = `${id}.jpg`;
  const thumbFile = `${id}_thumb.jpg`;
  const fullDest = new File(dir, file);

  try {
    const size = await renderTo(photoUri, fullDest, (ctx) => crop && ctx.crop(crop), 0.9);
    await renderTo(fullDest.uri, new File(dir, thumbFile), (ctx) => ctx.resize({ width: THUMB_WIDTH }), 0.7);

    const scan: StoredScan = {
      id,
      number: items.reduce((m, s) => Math.max(m, s.number), 0) + 1,
      createdAt: Date.now(),
      width: size.width,
      height: size.height,
      file,
      thumbFile,
    };
    items = [scan, ...items];
    await persist();
    emit();
    return hydrate(scan);
  } finally {
    deleteFile(photoUri);
  }
}

export async function removeScan(id: string): Promise<void> {
  await loadScans();
  const s = items.find((x) => x.id === id);
  if (!s) return;
  deleteFile(new File(scansDir(), s.file).uri);
  deleteFile(new File(scansDir(), s.thumbFile).uri);
  items = items.filter((x) => x.id !== id);
  await persist();
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useScans(): { scans: Scan[]; loaded: boolean } {
  const scans = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    loadScans();
  }, []);
  return { scans, loaded };
}

export function useScan(id: string | undefined): Scan | undefined {
  const { scans } = useScans();
  return scans.find((s) => s.id === id);
}
