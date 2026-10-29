"""Lưu kết quả detect của trang web kiểm tra vào thư mục data.

    data/detections/<id>/
        original.jpg|png|webp   ảnh người dùng upload (giữ nguyên byte nếu là jpg/png/webp)
        annotated.jpg           ảnh gốc có vẽ khung tìm được
        thumb.jpg               ảnh nhỏ cho danh sách
        warped.jpg              tài liệu đã nắn phẳng (chỉ có khi tìm thấy)
        result.json             toàn bộ bản ghi (kết quả, thời gian, kích thước...)
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import config, imaging

ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
THUMB_SIDE = 480
FILE_NAMES = ("original", "annotated", "thumb", "warped")


def _root() -> Path:
    root = config.DATA_DIR / "detections"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _dir(detection_id: str) -> Path:
    if not ID_RE.match(detection_id):
        raise KeyError(detection_id)
    d = _root() / detection_id
    if not d.is_dir():
        raise KeyError(detection_id)
    return d


def _original_ext(data: bytes) -> str | None:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _thumb(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    s = THUMB_SIDE / max(h, w)
    return cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img


def save(
    *,
    raw: bytes,
    img: np.ndarray,
    filename: str,
    version: str,
    result: dict,
    timings_ms: dict,
) -> dict:
    """Lưu một lượt detect, trả về bản ghi (cũng là nội dung result.json)."""
    detection_id = f"{datetime.now():%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"
    d = _root() / detection_id
    d.mkdir(parents=True)

    ext = _original_ext(raw)
    if ext:
        (d / f"original.{ext}").write_bytes(raw)
    else:  # định dạng khác (bmp, tiff...): lưu lại bằng JPEG chất lượng cao
        ext = "jpg"
        (d / "original.jpg").write_bytes(imaging.encode_jpeg(img, 95))

    annotated = imaging.draw_overlay(img, result)
    (d / "annotated.jpg").write_bytes(imaging.encode_jpeg(annotated, 88))
    (d / "thumb.jpg").write_bytes(imaging.encode_jpeg(_thumb(annotated), 80))

    files = {"original": f"original.{ext}", "annotated": "annotated.jpg", "thumb": "thumb.jpg"}
    if result.get("found"):
        (d / "warped.jpg").write_bytes(imaging.encode_jpeg(imaging.warp(img, result["corners"]), 92))
        files["warped"] = "warped.jpg"

    h, w = img.shape[:2]
    record = {
        "id": detection_id,
        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "filename": filename,
        "version": version,
        "imageSize": [w, h],
        "bytes": len(raw),
        "timingsMs": timings_ms,
        "files": files,
        "result": result,
    }
    (d / "result.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    return record


def get(detection_id: str) -> dict:
    return json.loads((_dir(detection_id) / "result.json").read_text(encoding="utf-8"))


def file_path(detection_id: str, kind: str) -> Path:
    if kind not in FILE_NAMES:
        raise KeyError(kind)
    name = get(detection_id)["files"].get(kind)
    if not name:
        raise KeyError(kind)
    return _dir(detection_id) / name


def summary(record: dict) -> dict:
    """Bản tóm tắt cho danh sách: bỏ phần `debug` nặng."""
    r = record["result"]
    return {
        "id": record["id"],
        "createdAt": record["createdAt"],
        "filename": record["filename"],
        "version": record["version"],
        "imageSize": record["imageSize"],
        "timingsMs": record["timingsMs"],
        "found": r["found"],
        "confidence": r.get("confidence"),
        "method": r.get("method"),
        "reason": r.get("reason"),
    }


def list_all() -> list[dict]:
    items = []
    for d in _root().iterdir():
        if not (d.is_dir() and ID_RE.match(d.name)):
            continue
        try:
            items.append(summary(json.loads((d / "result.json").read_text(encoding="utf-8"))))
        except (OSError, ValueError, KeyError):
            continue  # thư mục dở dang hoặc hỏng: bỏ qua
    items.sort(key=lambda x: x["id"], reverse=True)
    return items


def delete(detection_id: str) -> None:
    shutil.rmtree(_dir(detection_id))
