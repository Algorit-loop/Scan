import { decode } from 'jpeg-js';

import { base64ToBytes } from '../utils/base64';
import { detectDocument, rgbaToGray } from './detectDocument';
import type { DetectionResult } from './types';

/** Nhận diện ngay trên máy (khi không có server) từ một ảnh JPEG base64 nhỏ. */
export function detectLocalJpeg(b64: string): DetectionResult {
  const raw = decode(base64ToBytes(b64), { useTArray: true, formatAsRGBA: true });
  return detectDocument(rgbaToGray(raw.data, raw.width, raw.height));
}
