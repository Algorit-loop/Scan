import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type Sentence, speakable } from './compose';

export type ReaderOptions = {
  /** true: đọc xong một câu thì tự đọc câu tiếp; false: đọc từng câu, chờ người dùng bấm. */
  continuous: boolean;
  /** Tốc độ đọc (1 = bình thường). */
  rate: number;
};

export type Reader = {
  /** Câu đang chọn (-1: chưa chọn câu nào). */
  index: number;
  /** Đang phát tiếng. */
  speaking: boolean;
  /** Có giọng tiếng Việt trên máy không (null: chưa biết). */
  hasVietnameseVoice: boolean | null;
  /** Đọc câu thứ i. */
  speakAt: (i: number) => void;
  /** Đọc câu tiếp theo (đang ở câu cuối: báo hết). */
  next: () => void;
  /** Đọc câu trước (đang ở câu đầu: đọc lại câu đầu). */
  previous: () => void;
  /** Đọc lại câu đang chọn (chưa chọn: đọc câu đầu). */
  replay: () => void;
  stop: () => void;
};

const LANGUAGE = 'vi-VN';

/**
 * Điều khiển đọc từng câu bằng giọng đọc của máy (expo-speech: AVSpeechSynthesizer trên iOS, TextToSpeech trên Android
 * — không cần mạng). Ba thao tác chính: câu trước / đọc lại / câu sau; rung nhẹ khi chạm đầu hoặc cuối bài.
 *
 * `initialIndex`: câu đang chọn lúc bắt đầu (mở lại từ lịch sử: câu đang đọc dở).
 *
 * Mỗi lần đọc mang một số hiệu (`run`): sự kiện của lần đọc cũ (đã bị ngắt) không được đụng vào trạng thái của lần mới.
 */
export function useReader(sentences: Sentence[], options: ReaderOptions, initialIndex = -1): Reader {
  const [index, setIndex] = useState(initialIndex);
  const [speaking, setSpeaking] = useState(false);
  const [hasVietnameseVoice, setHasVietnameseVoice] = useState<boolean | null>(null);
  const run = useRef(0);
  const current = useRef(initialIndex);
  // Giá trị mới nhất cho các callback chạy sau (onDone của giọng đọc), cập nhật sau mỗi lần render.
  const latest = useRef({ sentences, options });
  useEffect(() => {
    latest.current = { sentences, options };
  });

  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((voices) => setHasVietnameseVoice(voices.some((v) => v.language?.toLowerCase().startsWith('vi'))))
      .catch(() => setHasVietnameseVoice(null));
  }, []);

  const say = useCallback((text: string, onDone?: () => void) => {
    const my = ++run.current;
    Speech.stop().catch(() => {});
    setSpeaking(true);
    const finish = (done: boolean) => {
      if (my !== run.current) return;
      setSpeaking(false);
      if (done) onDone?.();
    };
    Speech.speak(text, {
      language: LANGUAGE,
      rate: latest.current.options.rate,
      // iOS: để hệ thống quản lý phiên âm thanh của giọng đọc (không phụ thuộc phiên âm thanh của app / WebView camera).
      useApplicationAudioSession: false,
      onDone: () => finish(true),
      onStopped: () => finish(false),
      onError: () => finish(false),
    });
  }, []);

  // Đọc liên tục cần gọi lại chính speakAt khi đọc xong một câu: gọi qua ref để callback không tự tham chiếu.
  const speakAtRef = useRef<(i: number) => void>(() => {});
  const speakAt = useCallback(
    (i: number) => {
      const list = latest.current.sentences;
      if (!list.length) return;
      const k = Math.max(0, Math.min(list.length - 1, i));
      current.current = k;
      setIndex(k);
      say(speakable(list[k].text), () => {
        // Xong câu này thì sang câu sau, tới hết bài thì dừng.
        const now = latest.current;
        if (now.options.continuous && current.current === k && k + 1 < now.sentences.length) speakAtRef.current(k + 1);
      });
    },
    [say],
  );
  useEffect(() => {
    speakAtRef.current = speakAt;
  }, [speakAt]);

  const next = useCallback(() => {
    const n = latest.current.sentences.length;
    if (!n) return;
    if (current.current >= n - 1) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      say('Hết nội dung.');
      return;
    }
    speakAt(current.current + 1);
  }, [say, speakAt]);

  const previous = useCallback(() => {
    if (!latest.current.sentences.length) return;
    if (current.current <= 0) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speakAt(Math.max(0, current.current - 1));
  }, [speakAt]);

  const replay = useCallback(() => {
    speakAt(Math.max(0, current.current));
  }, [speakAt]);

  const stop = useCallback(() => {
    run.current++;
    setSpeaking(false);
    Speech.stop().catch(() => {});
  }, []);

  // Rời màn hình (hoặc nội dung khác: component dùng hook này được dựng lại theo `key`): ngừng đọc.
  useEffect(() => stop, [stop]);

  return { index, speaking, hasVietnameseVoice, speakAt, next, previous, replay, stop };
}
