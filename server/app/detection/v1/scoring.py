"""Chấm điểm tứ giác ứng viên (tài liệu mục 4.2, bước 4).

Điểm của mỗi cạnh = độ phủ cạnh thật dọc cạnh × độ tương phản giữa trong và ngoài.
Gộp 4 cạnh: có xét cạnh yếu nhất, nên một cạnh "ăn theo" vân gỗ hay đường kẻ vở không cứu được cả tứ giác.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import params as P
from .geometry import polygon_area


@dataclass
class ScoreContext:
    gx: np.ndarray
    gy: np.ndarray
    lab: np.ndarray            # ảnh Lab đã làm mờ nhẹ
    edge_thresh: float
    size: tuple[int, int]

    @classmethod
    def build(cls, smooth_gray: np.ndarray, lab: np.ndarray) -> "ScoreContext":
        g = cv2.GaussianBlur(smooth_gray, (0, 0), 1.2).astype(np.float32)
        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3) / 8.0
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3) / 8.0
        mag = np.hypot(gx, gy)
        thresh = max(4.0, 0.3 * float(np.percentile(mag, 97)))
        lab_blur = cv2.GaussianBlur(lab, (0, 0), 1.5)
        h, w = smooth_gray.shape
        return cls(gx, gy, lab_blur, thresh, (w, h))


def _sample(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Lấy giá trị tại các điểm (x, y) bằng cách làm tròn; điểm ngoài ảnh được kẹp (người gọi tự loại)."""
    h, w = img.shape[:2]
    xi = np.clip(np.rint(pts[..., 0]).astype(int), 0, w - 1)
    yi = np.clip(np.rint(pts[..., 1]).astype(int), 0, h - 1)
    return img[yi, xi]


def _side_metrics(a: np.ndarray, b: np.ndarray, ctx: ScoreContext) -> tuple[float, float, np.ndarray | None]:
    """Trả về (độ phủ cạnh 0..1, tương phản trong/ngoài, màu Lab trung vị phía trong hoặc None)."""
    w, h = ctx.size
    e = b - a
    length = float(np.linalg.norm(e))
    if length < 1:
        return 0.0, 0.0, None
    d = e / length
    n_in = np.array([-d[1], d[0]])             # pháp tuyến hướng vào trong (quad theo chiều kim đồng hồ)
    k = max(4, int(length / P.SAMPLE_STEP))
    t = np.linspace(P.SIDE_TRIM, 1 - P.SIDE_TRIM, k)
    pts = a[None, :] + t[:, None] * e[None, :]

    inside = pts + n_in * P.CONTRAST_OFFSET
    outside = pts - n_in * P.CONTRAST_OFFSET

    def valid(p: np.ndarray) -> np.ndarray:
        return (p[:, 0] >= 0) & (p[:, 0] <= w - 1) & (p[:, 1] >= 0) & (p[:, 1] <= h - 1)

    in_ok, out_ok = valid(inside), valid(outside)
    on_border = (
        np.minimum.reduce([pts[:, 0], pts[:, 1], w - 1 - pts[:, 0], h - 1 - pts[:, 1]]) <= P.BORDER_TOUCH_PX
    )
    assumed = in_ok & ~out_ok & on_border      # cạnh nằm sát mép ảnh: không thấy được phía ngoài

    # Độ phủ cạnh: gradient theo pháp tuyến, tìm trong ±EDGE_WINDOW.
    offs = np.arange(-P.EDGE_WINDOW, P.EDGE_WINDOW + 1, dtype=np.float32)
    probe = pts[:, None, :] + offs[None, :, None] * n_in[None, None, :]
    g = _sample(ctx.gx, probe) * n_in[0] + _sample(ctx.gy, probe) * n_in[1]
    edge_hit = np.abs(g).max(axis=1) >= ctx.edge_thresh
    cover = np.where(assumed, P.BORDER_CREDIT, np.where(in_ok & out_ok & edge_hit, 1.0, 0.0))

    # Tương phản: khoảng cách màu Lab giữa hai phía; dọc cạnh lấy trung vị để chịu được đoạn bị che.
    both = in_ok & out_ok
    col_in = _sample(ctx.lab, inside[in_ok]) if in_ok.any() else None
    if both.any():
        diff = np.linalg.norm(_sample(ctx.lab, inside[both]) - _sample(ctx.lab, outside[both]), axis=1)
        contrast = float(np.median(diff))
    else:
        contrast = 0.0
    if assumed.mean() > 0.5:
        contrast = max(contrast, P.CONTRAST_FULL * P.BORDER_CREDIT)
    return float(cover.mean()), contrast, (np.median(col_in, axis=0) if col_in is not None else None)


def score_quad(quad: np.ndarray, ctx: ScoreContext) -> tuple[float, dict]:
    sides = [(quad[i], quad[(i + 1) % 4]) for i in range(4)]
    lens, cov, con, ins = [], [], [], []
    for a, b in sides:
        c, k, col = _side_metrics(a, b, ctx)
        lens.append(float(np.linalg.norm(b - a)))
        cov.append(c)
        con.append(min(1.0, k / P.CONTRAST_FULL))
        if col is not None:
            ins.append(col)
    lens_a = np.array(lens)
    side_score = np.array(cov) * np.array(con)
    mean = float((side_score * lens_a).sum() / max(lens_a.sum(), 1e-6))
    overall = 0.65 * mean + 0.35 * float(side_score.min())

    # Màu phía trong của 4 cạnh phải giống nhau (cùng là mặt giấy); lệch nhiều = tứ giác vắt qua nhiều vật.
    consistency = 1.0
    if len(ins) >= 2:
        spread = max(float(np.linalg.norm(p - q)) for i, p in enumerate(ins) for q in ins[i + 1:])
        consistency = 1.0 - min(0.4, max(0.0, (spread - 15.0) / 40.0))

    w, h = ctx.size
    area = polygon_area(quad) / (w * h)
    size_factor = 0.9 + 0.1 * min(1.0, area / 0.4)

    score = overall * consistency * size_factor
    return score, {
        "coverage": [round(c, 3) for c in cov],
        "contrast": [round(c, 3) for c in con],
        "consistency": round(consistency, 3),
        "area": round(area, 3),
    }
