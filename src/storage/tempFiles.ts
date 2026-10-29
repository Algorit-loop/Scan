import { File, Paths } from 'expo-file-system';

import { stripDataUrl } from '../utils/base64';

/** Ghi JPEG base64 ra file tạm trong cache, trả về uri. */
export async function writeTempJpeg(b64: string): Promise<string> {
  const file = new File(Paths.cache, `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);
  file.create({ overwrite: true });
  await file.write(stripDataUrl(b64), { encoding: 'base64' });
  return file.uri;
}
