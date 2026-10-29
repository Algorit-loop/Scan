import { useCallback, useRef } from 'react';

import { haptic, say } from '../feedback/announcer';
import type { Instruction, TrackerState } from '../guidance/computeGuidance';
import { INSTRUCTION_TEXT, MESSAGES } from '../guidance/messages.vi';
import { ALIGNED_REMINDER_MS, MANUAL_HINT_MS } from './config';

/** Biến trạng thái hướng dẫn của mỗi khung hình thành giọng nói + rung. */
export function useGuidanceAnnouncer() {
  const lastInstruction = useRef<Instruction | null>(null);
  const alignedSpokenAt = useRef(0);
  const startedAt = useRef(Date.now());
  const hintGiven = useRef(false);

  return useCallback((s: TrackerState) => {
    const now = Date.now();
    if (s.justAligned) {
      say(MESSAGES.aligned, { important: true });
      haptic.success();
      alignedSpokenAt.current = now;
    } else if (s.aligned) {
      if (now - alignedSpokenAt.current > ALIGNED_REMINDER_MS) {
        say(MESSAGES.aligned);
        alignedSpokenAt.current = now;
      }
    } else {
      if (s.instruction !== lastInstruction.current) {
        if (s.instruction === 'notFound' || s.instruction === 'lowContrast') haptic.warning();
        else haptic.tick();
      }
      if (!hintGiven.current && now - startedAt.current > MANUAL_HINT_MS) {
        hintGiven.current = true;
        say(MESSAGES.manualHint, { important: true });
      } else {
        say(INSTRUCTION_TEXT[s.instruction]);
      }
    }
    lastInstruction.current = s.instruction;
  }, []);
}
