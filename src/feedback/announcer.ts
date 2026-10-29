import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

import { MESSAGES } from '../guidance/messages.vi';

const LANGUAGE = 'vi-VN';
/** Khoảng nghỉ tối thiểu sau khi đọc xong một câu, trước khi đọc câu thường tiếp theo. */
const GAP_AFTER_SPEECH_MS = 1200;
/** Không lặp lại cùng một câu thường trong khoảng này. */
const REPEAT_INTERVAL_MS = 3500;
/** Phòng khi engine không gọi onDone: coi như đã đọc xong sau khoảng này. */
const SPEECH_TIMEOUT_MS = 6000;

let voiceId: string | undefined;
let voiceChecked = false;

let utteranceId = 0;
let speaking = false;
let speakingImportant = false;
let startedAt = 0;
let doneAt = 0;
let lastText = '';
let lastAt = 0;

/** Tìm giọng tiếng Việt một lần; báo cho người dùng nếu máy không có. */
export async function initVoice(): Promise<void> {
  if (voiceChecked) return;
  voiceChecked = true;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const vi = voices.filter((v) => v.language.toLowerCase().replace('_', '-').startsWith('vi'));
    // Ưu tiên giọng chất lượng cao nếu có.
    vi.sort((a, b) =>
      a.quality === b.quality ? 0 : a.quality === Speech.VoiceQuality.Enhanced ? -1 : 1,
    );
    voiceId = vi[0]?.identifier;
    // Android có thể trả danh sách rỗng khi engine chưa sẵn sàng — khi đó vẫn thử nói vi-VN.
    if (voices.length > 0 && vi.length === 0) say(MESSAGES.noVietnameseVoice, { important: true });
  } catch {
    // Bỏ qua: vẫn nói bằng language code.
  }
}

function isBusy(now: number): boolean {
  if (speaking && now - startedAt > SPEECH_TIMEOUT_MS) speaking = false;
  return speaking;
}

type SayOptions = {
  /**
   * Câu quan trọng (đã căn chỉnh, đã lưu, lỗi...): được phép ngắt câu đang đọc.
   * Câu thường KHÔNG bao giờ ngắt câu khác — nếu đang bận thì bỏ qua,
   * khung hình sau sẽ đề xuất lại chỉ dẫn mới nhất.
   */
  important?: boolean;
};

/** Trả về true nếu câu thực sự được đọc. */
export function say(text: string, { important = false }: SayOptions = {}): boolean {
  const now = Date.now();
  if (!important) {
    if (isBusy(now)) return false;
    if (now - doneAt < GAP_AFTER_SPEECH_MS) return false;
    if (text === lastText && now - lastAt < REPEAT_INTERVAL_MS) return false;
  } else if (speakingImportant && isBusy(now) && text === lastText) {
    return false;
  }

  const id = ++utteranceId;
  lastText = text;
  lastAt = now;
  startedAt = now;
  speaking = true;
  speakingImportant = important;

  // Chỉ câu quan trọng mới cắt câu đang đọc.
  if (important) Speech.stop();

  const finish = () => {
    // Bỏ qua callback của câu cũ (ví dụ onStopped khi bị câu quan trọng cắt ngang).
    if (id !== utteranceId) return;
    speaking = false;
    speakingImportant = false;
    doneAt = Date.now();
  };
  Speech.speak(text, {
    language: LANGUAGE,
    voice: voiceId,
    rate: 1.0,
    onDone: finish,
    onStopped: finish,
    onError: finish,
  });
  return true;
}

export function stopSpeaking(): void {
  utteranceId++;
  speaking = false;
  speakingImportant = false;
  lastText = '';
  Speech.stop();
}

export const haptic = {
  tick: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
};
