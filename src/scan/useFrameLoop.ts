import type { CameraView } from 'expo-camera';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { WebCameraHandle } from '../camera/WebCamera';
import { analyzePhoto } from '../detection/analyzePhoto';
import { detectLocalJpeg } from '../detection/localDetect';
import type { DetectionResult } from '../detection/types';
import { AlignmentTracker, computeGuidance, type Instruction } from '../guidance/computeGuidance';
import type { ServerClient } from '../server/serverClient';
import {
  ANALYSIS_QUALITY,
  ANALYSIS_SIDE,
  MIN_FRAME_INTERVAL,
  SHOW_PERF,
  STATS_WINDOW,
} from './config';
import type { CameraMode, FrameAnalysis, FrameStats, LastAnalysis } from './types';
import { useGuidanceAnnouncer } from './useGuidanceAnnouncer';

type Options = {
  mode: CameraMode;
  /** Camera đã sẵn sàng chưa — vòng lặp chỉ chạy khi true. */
  ready: boolean;
  webCam: RefObject<WebCameraHandle | null>;
  nativeCam: RefObject<CameraView | null>;
  client: RefObject<ServerClient | null>;
};

export type ViewState = {
  instruction: Instruction | null;
  aligned: boolean;
  analysis: FrameAnalysis | null;
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Tham số làm mượt theo tốc độ khung hình của từng chế độ (~1 giây để xác nhận căn chỉnh). */
const newTracker = (mode: CameraMode) =>
  mode === 'web' ? new AlignmentTracker(6, 3, 3) : new AlignmentTracker(3, 2, 2);

/**
 * Vòng lặp: lấy 1 khung -> nhận diện (server, hoặc trên máy nếu không có server) -> hướng dẫn.
 * Chỉ lấy khung mới khi khung trước đã xong.
 */
export function useFrameLoop({ mode, ready, webCam, nativeCam, client }: Options) {
  const announce = useGuidanceAnnouncer();
  const tracker = useMemo(() => newTracker(mode), [mode]);

  const [view, setView] = useState<ViewState>({ instruction: null, aligned: false, analysis: null });
  const alive = useRef(true);
  const running = useRef(true);
  const currentStep = useRef<Promise<void> | null>(null);
  const last = useRef<LastAnalysis | null>(null);
  const stats = useRef<FrameStats[]>([]);
  const lastFrameAt = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      running.current = false;
    };
  }, []);

  /** Lấy 1 khung hình + nhận diện. */
  const analyzeOnce = useCallback(async (): Promise<{ analysis: FrameAnalysis; stats: FrameStats } | null> => {
    const t0 = performance.now();
    const s: FrameStats = { grab: 0, rtt: 0, server: 0, local: 0, total: 0, interval: 0, size: '', source: 'local' };

    if (mode === 'native') {
      const cam = nativeCam.current;
      if (!cam) return null;
      const photo = await cam.takePictureAsync({ quality: 0.3, shutterSound: false });
      s.grab = performance.now() - t0;
      const a = await analyzePhoto(photo.uri, photo.width, photo.height);
      s.local = a.timings.resize + a.timings.read + a.timings.decode + a.timings.detect;
      s.size = `${photo.width}x${photo.height}`;
      s.total = performance.now() - t0;
      return {
        analysis: { result: a.result, frameWidth: photo.width, frameHeight: photo.height, source: 'local' },
        stats: s,
      };
    }

    const cam = webCam.current;
    if (!cam) return null;
    const server = client.current;
    const online = server?.status === 'online';
    const frame = await cam.grab(online ? ANALYSIS_SIDE.server : ANALYSIS_SIDE.local, ANALYSIS_QUALITY);
    s.grab = performance.now() - t0;
    s.size = `${frame.width}x${frame.height}`;

    let result: DetectionResult | null = null;
    if (online && server) {
      try {
        const d = await server.detect(frame.data);
        result = d.result;
        s.rtt = d.rttMs;
        s.server = d.serverMs;
        s.source = 'server';
      } catch {
        // Server chậm/lỗi ở khung này -> nhận diện trên máy.
      }
    }
    if (!result) {
      const t = performance.now();
      result = detectLocalJpeg(frame.data);
      s.local = performance.now() - t;
    }
    s.total = performance.now() - t0;
    return {
      analysis: { result, frameWidth: frame.width, frameHeight: frame.height, source: s.source },
      stats: s,
    };
  }, [mode, nativeCam, webCam, client]);

  const step = useCallback(async () => {
    const out = await analyzeOnce();
    if (!out || !alive.current || !running.current) return;
    const { analysis, stats: s } = out;

    const now = Date.now();
    s.interval = lastFrameAt.current ? now - lastFrameAt.current : 0;
    lastFrameAt.current = now;
    stats.current = [...stats.current.slice(-(STATS_WINDOW - 1)), s];
    if (SHOW_PERF) {
      const r = Math.round;
      console.log(
        `[perf] ${mode}/${s.source} lấy khung ${r(s.grab)} | mạng+server ${r(s.rtt)} (server ${r(s.server)}) | trên máy ${r(s.local)} | tổng ${r(s.total)} ms | ${s.size}`,
      );
    }

    last.current = { analysis, at: now };
    const state = tracker.update(computeGuidance(analysis.result));
    announce(state);
    setView({ instruction: state.instruction, aligned: state.aligned, analysis });
  }, [analyzeOnce, announce, mode, tracker]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && alive.current) {
        if (!running.current) {
          await delay(200);
          continue;
        }
        const t0 = Date.now();
        const p = step().catch((e) => {
          if (SHOW_PERF) console.warn('[scan] lỗi khung:', e?.message ?? e);
          return delay(300);
        });
        currentStep.current = p;
        await p;
        currentStep.current = null;
        const wait = MIN_FRAME_INTERVAL[mode] - (Date.now() - t0);
        if (wait > 0) await delay(wait);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, step, mode]);

  /** Tạm dừng phân tích và đợi khung đang chạy xong (để không chụp chồng lên nhau). */
  const pause = useCallback(async () => {
    running.current = false;
    await currentStep.current;
  }, []);

  /** Chạy tiếp từ đầu (dùng khi chụp lỗi). */
  const resume = useCallback(() => {
    tracker.reset();
    running.current = true;
  }, [tracker]);

  return { view, stats: stats.current, last, pause, resume };
}
