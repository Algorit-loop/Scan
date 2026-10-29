"""Thước đo chất lượng: chỉ số Jaccard giữa tứ giác dự đoán và đáp án (mục 2 của tài liệu nghiên cứu)."""

from __future__ import annotations

import cv2
import numpy as np


def quad_jaccard(pred: list[dict], truth: list[dict], size: tuple[int, int] = (1000, 1000)) -> float:
    """JI = area(G ∩ A) / area(G ∪ A). Góc ở dạng chuẩn hóa 0..1 ({x, y}); tính bằng cách tô lên lưới `size`=(w,h)."""
    w, h = size

    def mask(quad: list[dict]) -> np.ndarray:
        m = np.zeros((h, w), np.uint8)
        pts = np.array([[c["x"] * w, c["y"] * h] for c in quad], np.int32)
        cv2.fillConvexPoly(m, cv2.convexHull(pts), 1)
        return m

    a, g = mask(pred), mask(truth)
    union = int(np.count_nonzero(a | g))
    return int(np.count_nonzero(a & g)) / union if union else 0.0
