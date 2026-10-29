import type { DetectionResult } from '../detection/types';

/**
 * - 'web'   : camera trong WebView, lấy khung hình liên tục (nhanh). Mặc định.
 * - 'native': expo-camera chụp ảnh liên tục (chậm) — dự phòng khi WebView không mở được camera.
 */
export type CameraMode = 'web' | 'native';

/** Kết quả nhận diện đến từ server hay tính trên máy. */
export type Source = 'server' | 'local';

export type FrameAnalysis = {
  result: DetectionResult;
  frameWidth: number;
  frameHeight: number;
  source: Source;
};

export type FrameStats = {
  /** Lấy khung hình: WebView vẽ+nén+gửi về, hoặc expo-camera chụp. */
  grab: number;
  /** Khứ hồi tới server (gồm cả thời gian server xử lý). */
  rtt: number;
  /** Thời gian xử lý thuần trên server. */
  server: number;
  /** Nhận diện trên máy (khi ngoại tuyến hoặc chế độ native). */
  local: number;
  total: number;
  /** Khoảng cách thực tế giữa 2 khung liên tiếp. */
  interval: number;
  size: string;
  source: Source;
};

export type LastAnalysis = { analysis: FrameAnalysis; at: number };
