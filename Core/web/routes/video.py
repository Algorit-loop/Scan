"""Dữ liệu cho trang /video: phát lại luồng xử lý video của app trên video SmartDoc thật.

Server chỉ đưa khung hình và nhãn. Detect chạy NGAY TRONG TRÌNH DUYỆT bằng đúng engine của app
(App/native/build/docdetect.js + App/web/worker.js, phục vụ ở /api/video/engine.js) và Tracker là
App/web/tracker.js. Rebuild engine hay sửa Tracker: tải lại trang là thấy, không có kết quả cũ nằm trong cache.

Video gốc: dataset/videos/<nền>/<tên>.avi (+ .gt.xml), trích từ dataset/_raw/testDataset.tar.gz.
"""

from __future__ import annotations

import json
import re
import threading
import xml.etree.ElementTree as ET
from pathlib import Path

import cv2
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from paths import CACHE_DIR, DATASET_DIR, PROJECT_DIR

router = APIRouter(prefix="/api/video")

VIDEO_DIR = DATASET_DIR / "videos"
APP_WEB = PROJECT_DIR / "App" / "web"
APP_ENGINE = PROJECT_DIR / "App" / "native" / "build" / "docdetect.js"
FRAME_W = 960  # khung lưu sẵn để detect trong trình duyệt (đủ cho lựa chọn 640 px)
_locks: dict[str, threading.Lock] = {}


def _video(vid: str) -> Path:
    if not re.fullmatch(r"background\d+/[a-z0-9_]+", vid):
        raise HTTPException(400, "Tên video không hợp lệ")
    path = VIDEO_DIR / f"{vid}.avi"
    if not path.is_file():
        raise HTTPException(404, "Không có video này")
    return path


def _ground_truth(path: Path, W: int, H: int) -> dict[int, list]:
    gt = {}
    xml = path.with_suffix(".gt.xml")
    if not xml.is_file():
        return gt
    for frame in ET.parse(xml).getroot().iter("frame"):
        if frame.get("rejected") == "true":
            continue
        pts = {p.get("name"): (float(p.get("x")) / W, float(p.get("y")) / H) for p in frame.iter("point")}
        if all(k in pts for k in ("tl", "tr", "br", "bl")):
            gt[int(frame.get("index"))] = [list(pts[k]) for k in ("tl", "tr", "br", "bl")]
    return gt


def app_config() -> dict:
    """Hằng số đang dùng trong app, đọc thẳng từ mã nguồn để trang không bị lệch khi sửa app."""
    cfg = {}
    for name in ("page.js", "worker.js"):
        f = APP_WEB / name
        if f.is_file():
            for key, value in re.findall(r"^\s*var ([A-Z_]+) = ([\d.]+);", f.read_text(encoding="utf-8"), re.M):
                cfg[key] = float(value)
    return cfg


def _build(vid: str) -> dict:
    """Tách khung (chỉ một lần, video gốc không đổi) + nhãn. Không detect ở đây."""
    path = _video(vid)
    out_dir = CACHE_DIR / "video" / vid
    meta = out_dir / "frames.json"
    if meta.is_file():
        data = json.loads(meta.read_text(encoding="utf-8"))
        if data.get("frameW") == FRAME_W and data.get("mtime") == path.stat().st_mtime:
            return data
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    gt = _ground_truth(path, W, H)
    frames, i = [], 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        i += 1
        small = cv2.resize(bgr, (FRAME_W, round(H * FRAME_W / W)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out_dir / f"{i}.jpg"), small, [cv2.IMWRITE_JPEG_QUALITY, 90])
        frames.append({"i": i, "gt": gt.get(i)})
    cap.release()
    data = {"id": vid, "fps": fps, "width": W, "height": H, "frameW": FRAME_W, "mtime": path.stat().st_mtime, "frames": frames}
    meta.write_text(json.dumps(data), encoding="utf-8")
    return data


@router.get("")
def list_videos() -> list[dict]:
    return [{"id": f"{f.parent.name}/{f.stem}", "background": f.parent.name, "name": f.stem}
            for f in sorted(VIDEO_DIR.glob("*/*.avi"))]


@router.get("/config")
def config() -> dict:
    return {"app": app_config(), "trackerAvailable": (APP_WEB / "tracker.js").is_file(), "engineAvailable": APP_ENGINE.is_file()}


def _js(path: Path) -> str:
    if not path.is_file():
        raise HTTPException(404, f"Không thấy {path.relative_to(PROJECT_DIR)}")
    return path.read_text(encoding="utf-8")


@router.get("/tracker.js")
def tracker_js() -> Response:
    return Response(_js(APP_WEB / "tracker.js"), media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@router.get("/engine.js")
def engine_js() -> Response:
    """Script cho Web Worker: engine WASM của app + App/web/worker.js, ghép y như trang quét trong app."""
    return Response(_js(APP_ENGINE) + "\n" + _js(APP_WEB / "worker.js"), media_type="text/javascript",
                    headers={"Cache-Control": "no-cache"})


@router.get("/data")
def data(v: str) -> dict:
    with _locks.setdefault(v, threading.Lock()):  # lần đầu tách khung (vài giây); các yêu cầu cùng lúc chờ nhau
        return _build(v)


@router.get("/frame")
def frame(v: str, i: int) -> FileResponse:
    _video(v)
    f = CACHE_DIR / "video" / v / f"{i}.jpg"
    if not f.is_file():
        raise HTTPException(404, "Chưa có khung này (gọi /api/video/data trước)")
    return FileResponse(f, headers={"Cache-Control": "max-age=86400"})


@router.get("/frame/full")
def frame_full(v: str, i: int) -> Response:
    """Khung độ phân giải gốc, dùng cho bước chụp (app chụp ở độ phân giải camera)."""
    cap = cv2.VideoCapture(str(_video(v)))
    cap.set(cv2.CAP_PROP_POS_FRAMES, i - 1)
    ok, bgr = cap.read()
    cap.release()
    if not ok:
        raise HTTPException(404, "Không đọc được khung")
    ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return Response(buf.tobytes(), media_type="image/jpeg")
