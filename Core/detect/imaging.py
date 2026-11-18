"""Hàm xử lý ảnh dùng chung (không phụ thuộc phiên bản detect nào)."""

from __future__ import annotations

import cv2
import numpy as np

WARP_MAX_SIDE = 2400


def decode_bytes(data: bytes) -> np.ndarray:
    """Byte của file ảnh -> ảnh BGR. OpenCV tự xoay theo EXIF nên ảnh chụp bằng điện thoại không bị nghiêng."""
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Không đọc được ảnh (file hỏng hoặc không phải ảnh)")
    return img


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


# ---------------- Chuẩn hóa đầu vào detect (dùng chung cho web và tools/evaluate.py) ----------------
LETTERBOX_SIZE = 256
LETTERBOX_PAD = 114


def letterbox(img: np.ndarray, size: int = LETTERBOX_SIZE) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """Ảnh bất kỳ -> ảnh size×size giữ tỉ lệ, phần thừa tô xám. Trả (ảnh, roi=(x, y, w, h) của vùng ảnh thật)."""
    h, w = img.shape[:2]
    s = size / max(h, w)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    out = np.full((size, size, 3), LETTERBOX_PAD, np.uint8)
    dx, dy = (size - nw) // 2, (size - nh) // 2
    out[dy:dy + nh, dx:dx + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    return out, (dx, dy, nw, nh)


def detect_letterboxed(detector, img: np.ndarray, size: int = LETTERBOX_SIZE) -> dict:
    """Letterbox rồi detect, bỏ qua dải viền (roi). Vùng ảnh thật là ảnh gốc thu nhỏ đều, nên tọa độ chuẩn hóa
    theo roi cũng chính là tọa độ chuẩn hóa trên ảnh gốc — không cần đổi ngược."""
    from . import detect_in_roi

    boxed, roi = letterbox(img, size)
    return detect_in_roi(detector, boxed, roi)
