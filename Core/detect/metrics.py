"""Thước đo chất lượng: chỉ số Jaccard giữa tứ giác dự đoán và đáp án, và bảng tổng hợp một lượt đánh giá."""

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


SUCCESS_IOU = 0.9  # IoU ≥ ngưỡng này = "dùng được ngay"


def summarize(items: list[dict]) -> dict:
    """items: các dòng kết quả của tools/evaluate.py (gtFound, found, iou, cornerErr, ms)."""
    if not items:
        return {"images": 0, "positives": 0, "negatives": 0}
    pos = [i for i in items if i["gtFound"]]
    neg = [i for i in items if not i["gtFound"]]
    ious = np.array([i["iou"] for i in pos]) if pos else np.zeros(0)
    errs = [i["cornerErr"] for i in pos if i["cornerErr"] is not None]
    ms = np.array([i["ms"] for i in items])
    return {
        "images": len(items),
        "positives": len(pos),
        "negatives": len(neg),
        "meanIoU": round(float(ious.mean()), 4) if pos else None,
        "medianIoU": round(float(np.median(ious)), 4) if pos else None,
        "success": round(float((ious >= SUCCESS_IOU).mean()), 4) if pos else None,
        "foundRate": round(sum(i["found"] for i in pos) / len(pos), 4) if pos else None,
        "cornerErr": round(float(np.mean(errs)), 4) if errs else None,
        "falsePositive": round(sum(i["found"] for i in neg) / len(neg), 4) if neg else None,
        "msMedian": round(float(np.median(ms)), 1),
        "msP95": round(float(np.percentile(ms, 95)), 1),
        "fps": round(1000 / float(np.median(ms)), 1),
        "histogram": np.histogram(ious, bins=10, range=(0, 1))[0].tolist() if pos else [],
    }
