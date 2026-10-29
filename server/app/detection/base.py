"""Hợp đồng chung cho mọi phiên bản detect.

Kết quả (dict, serialize được ra JSON) giữ nguyên định dạng mà app đang dùng
(xem `DetectionResult` ở src/_disabled/detection cũ của app):

    found=True : found, bbox, corners[TL,TR,BR,BL], areaRatio, touches, confidence, method
    found=False: found, reason ('none' | 'lowContrast')

Mỗi phiên bản được phép thêm trường phụ (ví dụ `debug`) — app bỏ qua trường lạ.
"""

from __future__ import annotations

from typing import Any, Protocol

import numpy as np

EDGE_TOUCH_MARGIN = 0.015

DetectionResult = dict[str, Any]


class Detector(Protocol):
    version: str
    name: str
    description: str

    def detect(self, img: np.ndarray) -> DetectionResult:
        """img: ảnh BGR (bất kỳ kích thước). Trả về kết quả theo hợp đồng ở trên."""
        ...


def not_found(reason: str = "none", **extra: Any) -> DetectionResult:
    return {"found": False, "reason": reason, **extra}


def found_result(
    corners_px: np.ndarray, size: tuple[int, int], confidence: float, method: str, **extra: Any
) -> DetectionResult:
    """corners_px: 4 góc TL,TR,BR,BL theo pixel của ảnh kích thước `size`=(w,h)."""
    w, h = size
    norm = np.asarray(corners_px, dtype=np.float32) / np.array([w, h], dtype=np.float32)
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
        "confidence": float(max(0.0, min(1.0, confidence))),
        "method": method,
        **extra,
    }
