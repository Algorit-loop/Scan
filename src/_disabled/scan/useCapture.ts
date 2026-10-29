import type { CameraView } from 'expo-camera';
import { router } from 'expo-router';
import { type RefObject, useCallback, useRef, useState } from 'react';

import type { WebCameraHandle } from '../camera/WebCamera';
import { haptic, say } from '../feedback/announcer';
import { MESSAGES } from '../guidance/messages.vi';
import type { ServerClient } from '../server/serverClient';
import { addScan, type CropRect } from '../storage/scans';
import { writeTempJpeg } from '../storage/tempFiles';
import { CAPTURE_QUALITY, CAPTURE_SIDE, RESULT_MAX_AGE_MS } from './config';
import { cropFor } from './crop';
import type { CameraMode, LastAnalysis } from './types';

type Options = {
  mode: CameraMode;
  ready: boolean;
  webCam: RefObject<WebCameraHandle | null>;
  nativeCam: RefObject<CameraView | null>;
  client: RefObject<ServerClient | null>;
  last: RefObject<LastAnalysis | null>;
  pause: () => Promise<void>;
  resume: () => void;
};

/** Chạm để chụp: dừng phân tích, chụp ảnh cuối, (nắn phẳng nếu có server), lưu, quay về danh sách. */
export function useCapture({ mode, ready, webCam, nativeCam, client, last, pause, resume }: Options) {
  const [busy, setBusy] = useState(false);
  /** true sau khi lưu xong — để màn hình không cắt câu "Đã lưu tài liệu" khi đóng. */
  const saved = useRef(false);

  /** Chụp ảnh cuối, trả về [uri, vùng cắt]. Có server thì nắn phẳng theo 4 góc. */
  const captureFinal = useCallback(async (): Promise<[string, CropRect | undefined]> => {
    const l = last.current;
    const recent = l && Date.now() - l.at < RESULT_MAX_AGE_MS ? l.analysis.result : null;

    if (mode === 'native') {
      const photo = await nativeCam.current!.takePictureAsync({ quality: 0.9, shutterSound: true });
      return [photo.uri, cropFor(recent, photo.width, photo.height)];
    }

    const full = await webCam.current!.grab(CAPTURE_SIDE, CAPTURE_QUALITY, 10000);
    const server = client.current;
    if (server?.status === 'online' && recent?.found) {
      try {
        const warped = await server.warp(full.data, recent.corners);
        return [await writeTempJpeg(warped.image), undefined];
      } catch (e) {
        console.warn('[scan] nắn phẳng trên server lỗi, lưu ảnh cắt thường:', (e as Error).message);
      }
    }
    return [await writeTempJpeg(full.data), cropFor(recent, full.width, full.height)];
  }, [mode, nativeCam, webCam, client, last]);

  const capture = useCallback(async () => {
    if (busy || !ready) return;
    setBusy(true);
    await pause();
    say(MESSAGES.capturing, { important: true });
    try {
      const [uri, crop] = await captureFinal();
      await addScan(uri, crop);
      saved.current = true;
      say(MESSAGES.saved, { important: true });
      haptic.success();
      router.back();
    } catch (e) {
      console.warn('[scan] chụp lỗi:', (e as Error).message);
      say(MESSAGES.saveFailed, { important: true });
      haptic.error();
      resume();
      setBusy(false);
    }
  }, [busy, ready, pause, resume, captureFinal]);

  return { busy, capture, saved };
}
