"""Hàm xử lý ảnh dùng chung (không phụ thuộc phiên bản detect nào)."""

from __future__ import annotations

import base64

import cv2
import numpy as np

WARP_MAX_SIDE = 2400


def decode_bytes(data: bytes) -> np.ndarray:
    """Byte của file ảnh -> ảnh BGR. OpenCV tự xoay theo EXIF nên ảnh chụp bằng điện thoại không bị nghiêng."""
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Không đọc được ảnh (file hỏng hoặc không phải ảnh)")
    return img


def decode_b64(b64: str) -> np.ndarray:
    """base64 (có hoặc không có tiền tố data URL) -> ảnh BGR."""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return decode_bytes(base64.b64decode(b64))


def encode_jpeg(img: np.ndarray, quality: int = 92) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("Không encode được ảnh")
    return buf.tobytes()


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Sắp 4 điểm theo thứ tự: trên-trái, trên-phải, dưới-phải, dưới-trái."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()  # y - x
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def warp(img: np.ndarray, corners_norm: list[dict]) -> np.ndarray:
    """Nắn phẳng tài liệu theo 4 góc (tọa độ chuẩn hóa 0..1)."""
    h, w = img.shape[:2]
    src = order_corners(np.array([[c["x"] * w, c["y"] * h] for c in corners_norm], dtype=np.float32))
    tl, tr, br, bl = src
    out_w = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    out_h = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    scale = min(1.0, WARP_MAX_SIDE / max(out_w, out_h, 1))
    out_w, out_h = max(1, int(out_w * scale)), max(1, int(out_h * scale))
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (out_w, out_h), flags=cv2.INTER_CUBIC)


def draw_overlay(img: np.ndarray, result: dict) -> np.ndarray:
    """Vẽ tứ giác + 4 góc lên bản sao của ảnh gốc (độ dày tự co giãn theo kích thước ảnh)."""
    out = img.copy()
    if not result.get("found"):
        return out
    h, w = out.shape[:2]
    t = max(2, round(max(h, w) / 350))
    pts = np.array([[c["x"] * w, c["y"] * h] for c in result["corners"]], np.int32)
    shade = out.copy()
    cv2.fillPoly(shade, [pts], (255, 140, 0))
    out = cv2.addWeighted(shade, 0.18, out, 0.82, 0)
    cv2.polylines(out, [pts], True, (255, 140, 0), t, cv2.LINE_AA)
    for i, (x, y) in enumerate(pts):
        cv2.circle(out, (int(x), int(y)), t * 3, (0, 212, 255), -1, cv2.LINE_AA)
        cv2.circle(out, (int(x), int(y)), t * 3, (0, 0, 0), max(1, t // 2), cv2.LINE_AA)
    return out
