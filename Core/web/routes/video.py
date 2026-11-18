"""Dữ liệu cho trang /video: phát lại luồng xử lý video của app trên video SmartDoc thật.

Mỗi khung được xử lý như app (App/web/page.js): thu nhỏ cạnh dài về DETECT_SIDE, RGBA, gọi docdetect_v3 native
(bản wasm trong app cho cùng kết quả — App/native/verify). Tracker chạy trong trình duyệt bằng chính
App/web/tracker.js. Video gốc: dataset/videos/<nền>/<tên>.avi (+ .gt.xml), trích từ dataset/_raw/testDataset.tar.gz.
"""

from __future__ import annotations

import ctypes as C
import json
import re
import threading
import xml.etree.ElementTree as ET
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from detect.v3 import Params, Result
from detect.v3.explain import _lib, _url, warp
from paths import CACHE_DIR, DATASET_DIR, PROJECT_DIR

router = APIRouter(prefix="/api/video")

VIDEO_DIR = DATASET_DIR / "videos"
APP_WEB = PROJECT_DIR / "App" / "web"
THUMB_W = 640
DD3_RGBA = 5
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


def detect_rgba(rgba: np.ndarray) -> dict:
    h, w = rgba.shape[:2]
    p, r = Params(), Result()
    _lib().dd3_default_params(C.byref(p))
    _lib().dd3_detect(rgba.ctypes.data, w, h, w * 4, DD3_RGBA, C.byref(p), C.byref(r))
    return {"found": bool(r.found), "reason": r.reason, "score": round(r.score, 3), "ms": round(r.ms_total, 2),
            "corners": [[round(r.corners[i].x, 4), round(r.corners[i].y, 4)] for i in range(4)] if r.found else None}


def _build(vid: str) -> dict:
    path = _video(vid)
    out_dir = CACHE_DIR / "video" / vid
    cache = out_dir / "data.json"
    side = int(app_config().get("DETECT_SIDE", 384))
    if cache.is_file():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("detectSide") == side:
            return data
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    gt = _ground_truth(path, W, H)
    frames = []
    i = 0
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        i += 1
        k = min(1.0, side / max(W, H))
        small = cv2.resize(bgr, (round(W * k), round(H * k)), interpolation=cv2.INTER_AREA)
        det = detect_rgba(np.ascontiguousarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGBA)))
        thumb = cv2.resize(bgr, (THUMB_W, round(H * THUMB_W / W)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(out_dir / f"{i}.jpg"), thumb, [cv2.IMWRITE_JPEG_QUALITY, 82])
        frames.append({"i": i, **det, "gt": gt.get(i)})
    cap.release()
    data = {"id": vid, "fps": fps, "width": W, "height": H, "detectSide": side, "frames": frames}
    cache.write_text(json.dumps(data), encoding="utf-8")
    return data


@router.get("")
def list_videos() -> list[dict]:
    out = []
    for f in sorted(VIDEO_DIR.glob("*/*.avi")):
        out.append({"id": f"{f.parent.name}/{f.stem}", "background": f.parent.name, "name": f.stem})
    return out


@router.get("/config")
def config() -> dict:
    return {"app": app_config(), "trackerAvailable": (APP_WEB / "tracker.js").is_file()}


@router.get("/tracker.js")
def tracker_js() -> Response:
    f = APP_WEB / "tracker.js"
    if not f.is_file():
        raise HTTPException(404, "Không thấy App/web/tracker.js")
    return Response(f.read_text(encoding="utf-8"), media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@router.get("/data")
def data(v: str) -> dict:
    lock = _locks.setdefault(v, threading.Lock())
    with lock:  # lần đầu xử lý cả video (vài giây); các yêu cầu cùng lúc chờ nhau
        return _build(v)


@router.get("/frame")
def frame(v: str, i: int) -> FileResponse:
    _video(v)
    f = CACHE_DIR / "video" / v / f"{i}.jpg"
    if not f.is_file():
        raise HTTPException(404, "Chưa có khung này (gọi /api/video/data trước)")
    return FileResponse(f, headers={"Cache-Control": "max-age=86400"})


@router.get("/capture")
def capture(v: str, i: int, q: str | None = None) -> dict:
    """Mô phỏng bước chụp của worker.js: detect lại trên khung độ phân giải gốc, so với khung đang theo dõi
    (q = 8 số chuẩn hóa), chọn bên đáng tin rồi nắn phẳng."""
    path = _video(v)
    cap = cv2.VideoCapture(str(path))
    cap.set(cv2.CAP_PROP_POS_FRAMES, i - 1)
    ok, bgr = cap.read()
    cap.release()
    if not ok:
        raise HTTPException(404, "Không đọc được khung")
    agree = app_config().get("CAPTURE_AGREE", 0.04)
    det = detect_rgba(np.ascontiguousarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)))
    hint = None
    if q:
        vals = [float(x) for x in q.split(",")]
        if len(vals) == 8:
            hint = [vals[k:k + 2] for k in range(0, 8, 2)]
    dist = None
    if det["found"] and hint:
        dist = max(float(np.hypot(a[0] - b[0], a[1] - b[1])) for a, b in zip(det["corners"], hint))
    if det["found"] and (hint is None or dist < agree):
        used, corners = "detect", det["corners"]
    elif hint:
        used, corners = "tracked", hint
    elif det["found"]:
        used, corners = "detect", det["corners"]
    else:
        used, corners = "none", None
    H, W = bgr.shape[:2]
    out = {"width": W, "height": H, "detect": det, "hint": hint, "maxDist": dist, "agree": agree, "used": used,
           "corners": corners, "frame": _url(cv2.resize(bgr, (THUMB_W, round(H * THUMB_W / W)), interpolation=cv2.INTER_AREA), ".jpg")}
    if corners:
        out["warp"] = _url(warp(bgr, corners, 1000), ".jpg")
    return out
