"""Phát hiện tài liệu bằng OpenCV.

Kết quả trả về cùng định dạng với `DetectionResult` của app (src/detection/types.ts),
để app dùng chung logic hướng dẫn cho cả chế độ server và chế độ ngoại tuyến.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np

# Cạnh dài nhất của ảnh khi phân tích — đủ chi tiết mà vẫn nhanh.
ANALYSIS_MAX_SIDE = 400
MIN_AREA_RATIO = 0.05
LOW_CONTRAST_STD = 12.0
EDGE_TOUCH_MARGIN = 0.015
WARP_MAX_SIDE = 2400


def decode_image(b64: str) -> np.ndarray:
    """base64 (có hoặc không có tiền tố data URL) -> ảnh BGR."""
    if b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    buf = np.frombuffer(base64.b64decode(b64), dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Không decode được ảnh")
    return img


def encode_jpeg(img: np.ndarray, quality: int = 92) -> str:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError("Không encode được ảnh")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def order_corners(pts: np.ndarray) -> np.ndarray:
    """Sắp 4 điểm theo thứ tự: trên-trái, trên-phải, dưới-phải, dưới-trái."""
    pts = pts.reshape(4, 2).astype(np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()  # y - x
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def _resize_for_analysis(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    scale = ANALYSIS_MAX_SIDE / max(h, w)
    if scale >= 1:
        return img
    return cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)


def _quad_from_edges(gray: np.ndarray) -> np.ndarray | None:
    """Tìm tứ giác lồi lớn nhất từ biên Canny (bám đúng mép giấy, kể cả khi nghiêng)."""
    h, w = gray.shape
    median = float(np.median(gray))
    lo = int(max(0, 0.66 * median))
    hi = int(min(255, 1.33 * median))
    edges = cv2.Canny(gray, lo, max(hi, lo + 30))
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = MIN_AREA_RATIO * w * h
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:10]:
        hull = cv2.convexHull(c)
        if cv2.contourArea(hull) < min_area:
            break
        peri = cv2.arcLength(hull, True)
        for eps in (0.02, 0.03, 0.05):
            approx = cv2.approxPolyDP(hull, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                return order_corners(approx)
    return None


def _quad_from_brightness(gray: np.ndarray) -> np.ndarray | None:
    """Dự phòng: vùng sáng lớn nhất (giấy sáng trên nền tối), bọc bằng hình chữ nhật xoay."""
    h, w = gray.shape
    _, mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(c)
    if area < MIN_AREA_RATIO * w * h:
        return None
    rect = cv2.minAreaRect(c)
    rw, rh = rect[1]
    if rw * rh <= 0 or area / (rw * rh) < 0.6:
        return None
    # Vùng sáng phủ gần kín khung nhưng không "đặc" => nền sáng, không phải giấy.
    x, y, bw, bh = cv2.boundingRect(c)
    if bw >= w - 2 and bh >= h - 2 and area < 0.85 * w * h:
        return None
    return order_corners(cv2.boxPoints(rect))


def detect(img: np.ndarray) -> dict:
    small = _resize_for_analysis(img)
    h, w = small.shape[:2]
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    if float(gray.std()) < LOW_CONTRAST_STD:
        return {"found": False, "reason": "lowContrast"}

    method = "edges"
    quad = _quad_from_edges(gray)
    if quad is None:
        method = "brightness"
        quad = _quad_from_brightness(gray)
    if quad is None:
        return {"found": False, "reason": "none"}

    norm = quad / np.array([w, h], dtype=np.float32)
    norm = np.clip(norm, 0.0, 1.0)
    x0, y0 = norm.min(axis=0)
    x1, y1 = norm.max(axis=0)
    m = EDGE_TOUCH_MARGIN
    return {
        "found": True,
        "bbox": {"x": float(x0), "y": float(y0), "w": float(x1 - x0), "h": float(y1 - y0)},
        "corners": [{"x": float(px), "y": float(py)} for px, py in norm],
        "areaRatio": float((x1 - x0) * (y1 - y0)),
        "touches": {
            "left": bool(x0 <= m),
            "right": bool(x1 >= 1 - m),
            "top": bool(y0 <= m),
            "bottom": bool(y1 >= 1 - m),
        },
        "confidence": 0.9 if method == "edges" else 0.6,
        "method": method,
    }


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
