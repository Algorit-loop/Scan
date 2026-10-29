import type { CameraMode } from './types';

/** Khoảng tối thiểu giữa 2 lần phân tích (ms). */
export const MIN_FRAME_INTERVAL: Record<CameraMode, number> = { web: 100, native: 250 };
/** Cạnh dài của khung gửi đi phân tích: server chịu được ảnh lớn hơn máy. */
export const ANALYSIS_SIDE = { server: 480, local: 240 };
export const ANALYSIS_QUALITY = 0.7;
/** Ảnh chụp cuối: lấy nguyên độ phân giải video. */
export const CAPTURE_SIDE = 4096;
export const CAPTURE_QUALITY = 0.92;
/** Không mở được camera WebView trong khoảng này thì chuyển sang chế độ chụp ảnh. */
export const WEB_CAMERA_TIMEOUT_MS = 8000;
/** Lặp lại câu "đã căn chỉnh" sau mỗi khoảng này nếu người dùng chưa chụp. */
export const ALIGNED_REMINDER_MS = 6000;
/** Gợi ý chụp thủ công nếu sau khoảng này vẫn chưa căn được. */
export const MANUAL_HINT_MS = 20000;
/** Kết quả nhận diện cũ hơn khoảng này thì không dùng để crop/nắn phẳng. */
export const RESULT_MAX_AGE_MS = 1500;
export const CROP_PADDING = 0.03;
/** Hiện bảng đo thời gian trên màn quét và log ra terminal. Tắt khi phát hành. */
export const SHOW_PERF = true;
export const STATS_WINDOW = 10;
