import type { DetectionResult } from '../detection/types';
import type { CropRect } from '../storage/scans';
import { CROP_PADDING } from './config';

/** Hình chữ nhật cắt quanh tài liệu (kèm lề nhỏ), hoặc undefined nếu không cần/không nên cắt. */
export function cropFor(result: DetectionResult | null, w: number, h: number): CropRect | undefined {
  if (!result?.found || result.confidence < 0.2) return undefined;
  const x0 = Math.max(0, result.bbox.x - CROP_PADDING);
  const y0 = Math.max(0, result.bbox.y - CROP_PADDING);
  const x1 = Math.min(1, result.bbox.x + result.bbox.w + CROP_PADDING);
  const y1 = Math.min(1, result.bbox.y + result.bbox.h + CROP_PADDING);
  if ((x1 - x0) * (y1 - y0) > 0.95) return undefined; // gần như cả khung — khỏi cắt
  return {
    originX: Math.round(x0 * w),
    originY: Math.round(y0 * h),
    width: Math.round((x1 - x0) * w),
    height: Math.round((y1 - y0) * h),
  };
}
