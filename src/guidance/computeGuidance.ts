import type { DetectionResult } from '../detection/types';

export type Instruction =
  | 'notFound'
  | 'lowContrast'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'closer'
  | 'farther'
  | 'hold';

/**
 * Chiều nói hướng trái/phải/lên/xuống:
 * - 'target': theo yêu cầu ban đầu — tài liệu lệch phải -> "Di chuyển sang trái"
 *   (tức là dời tài liệu về giữa).
 * - 'phone': tài liệu lệch phải -> "Di chuyển sang phải" (dời điện thoại theo tài liệu).
 */
export type DirectionMode = 'target' | 'phone';

export const DIRECTION_MODE: DirectionMode = 'target';

export type GuidanceConfig = {
  directionMode: DirectionMode;
  /** Độ lệch tâm tối đa (tỉ lệ khung) vẫn coi là đã căn giữa. */
  centerTolerance: number;
  minAreaRatio: number;
  maxAreaRatio: number;
};

export const DEFAULT_GUIDANCE: GuidanceConfig = {
  directionMode: DIRECTION_MODE,
  centerTolerance: 0.08,
  minAreaRatio: 0.35,
  maxAreaRatio: 0.85,
};

/**
 * Chọn MỘT chỉ dẫn quan trọng nhất cho khung hình hiện tại.
 * Thứ tự: không thấy -> quá gần -> lệch tâm -> quá xa -> giữ yên.
 * Căn giữa trước khi bảo "lại gần" để tài liệu không bị đẩy ra khỏi khung.
 */
export function computeGuidance(
  det: DetectionResult,
  config: GuidanceConfig = DEFAULT_GUIDANCE,
): Instruction {
  if (!det.found) return det.reason === 'lowContrast' ? 'lowContrast' : 'notFound';

  const { bbox, areaRatio, touches } = det;
  if (areaRatio > config.maxAreaRatio) return 'farther';
  if ((touches.left && touches.right) || (touches.top && touches.bottom)) return 'farther';

  const dx = bbox.x + bbox.w / 2 - 0.5; // > 0: tài liệu lệch phải
  const dy = bbox.y + bbox.h / 2 - 0.5; // > 0: tài liệu lệch xuống dưới
  const offX = Math.abs(dx) > config.centerTolerance;
  const offY = Math.abs(dy) > config.centerTolerance;

  if (offX || offY) {
    const flip = config.directionMode === 'target';
    if (offX && (!offY || Math.abs(dx) >= Math.abs(dy))) {
      return dx > 0 === flip ? 'left' : 'right';
    }
    return dy > 0 === flip ? 'up' : 'down';
  }

  if (areaRatio < config.minAreaRatio) return 'closer';
  return 'hold';
}

export type TrackerState = {
  instruction: Instruction;
  aligned: boolean;
  /** true đúng một lần, ở khung hình chuyển sang trạng thái đã căn chỉnh. */
  justAligned: boolean;
};

/**
 * Làm mượt theo thời gian:
 * - cần `framesToAlign` khung "hold" liên tiếp mới coi là đã căn chỉnh,
 *   và `framesToLose` khung lệch liên tiếp mới bỏ trạng thái đó;
 * - chỉ dẫn trả ra chỉ đổi khi chỉ dẫn mới lặp lại `framesToSwitch` khung liên tiếp,
 *   để một khung nhiễu không làm app đổi câu nói.
 */
export class AlignmentTracker {
  private holdStreak = 0;
  private offStreak = 0;
  private aligned = false;
  private candidate: Instruction | null = null;
  private candidateCount = 0;
  private stable: Instruction | null = null;

  constructor(
    private readonly framesToAlign = 3,
    private readonly framesToLose = 2,
    private readonly framesToSwitch = 2,
  ) {}

  update(instruction: Instruction): TrackerState {
    if (instruction === this.candidate) this.candidateCount++;
    else {
      this.candidate = instruction;
      this.candidateCount = 1;
    }
    if (this.stable === null || this.candidateCount >= this.framesToSwitch) this.stable = instruction;

    if (instruction === 'hold') {
      this.holdStreak++;
      this.offStreak = 0;
    } else {
      this.offStreak++;
      this.holdStreak = 0;
    }

    let justAligned = false;
    if (!this.aligned && this.holdStreak >= this.framesToAlign) {
      this.aligned = true;
      justAligned = true;
    } else if (this.aligned && this.offStreak >= this.framesToLose) {
      this.aligned = false;
    }

    return {
      instruction: this.aligned ? 'hold' : (this.stable ?? instruction),
      aligned: this.aligned,
      justAligned,
    };
  }

  reset() {
    this.holdStreak = 0;
    this.offStreak = 0;
    this.aligned = false;
    this.candidate = null;
    this.candidateCount = 0;
    this.stable = null;
  }
}
