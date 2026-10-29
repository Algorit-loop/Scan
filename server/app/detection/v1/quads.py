"""Sinh ứng viên tứ giác: từ giao điểm của các đường (chính) và từ vùng nền/giấy (dự phòng)."""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from . import params as P
from .geometry import angle_diff, is_convex, order_clockwise, polygon_area
from .lines import Line


@dataclass
class Candidate:
    quad: np.ndarray               # 4x2, theo chiều kim đồng hồ, bắt đầu từ trên-trái
    source: str                    # 'lines' | 'color' | 'bright' | 'dark' | 'grabcut'
    prescore: float = 0.0          # điểm rẻ (độ phủ của đường lên chu vi) dùng để lọc trước
    score: float = 0.0
    detail: dict = field(default_factory=dict)


def from_lines(lines: list[Line], size: tuple[int, int]) -> list[Candidate]:
    w, h = size
    side = max(w, h)
    n = len(lines)
    if n < 4:
        return []
    N = np.array([ln.n for ln in lines])
    C = np.array([ln.c for ln in lines])
    A = np.array([ln.angle for ln in lines])

    det = N[:, 0, None] * N[None, :, 1] - N[:, 1, None] * N[None, :, 0]
    safe = np.where(np.abs(det) < 1e-6, np.nan, det)
    X = (C[:, None] * N[None, :, 1] - N[:, 1, None] * C[None, :]) / safe
    Y = (N[:, 0, None] * C[None, :] - C[:, None] * N[None, :, 0]) / safe

    # Cặp cạnh đối: gần song song và đủ xa nhau.
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            if angle_diff(A[i], A[j]) > P.PARALLEL_TOL:
                continue
            nm = N[i] if (N[i] @ N[j]) >= 0 else -N[i]
            if abs(float((lines[i].p - lines[j].p) @ nm)) < P.MIN_SIDE_SEPARATION * side:
                continue
            # Hướng trung bình của cặp (trung bình trên góc nhân đôi vì hướng đường chỉ có nghĩa mod π).
            ang = 0.5 * np.arctan2(np.sin(2 * A[i]) + np.sin(2 * A[j]), np.cos(2 * A[i]) + np.cos(2 * A[j]))
            pairs.append((i, j, float(ang)))

    mx, my = P.CORNER_MARGIN * w, P.CORNER_MARGIN * h
    min_area = P.MIN_AREA_RATIO * w * h
    out: list[Candidate] = []
    for ia, (a, b, ang_ab) in enumerate(pairs):
        for c, d, ang_cd in pairs[ia + 1:]:
            if len({a, b, c, d}) < 4:
                continue
            if abs(np.sin(ang_ab - ang_cd)) < P.MIN_CORNER_ANGLE_SIN:
                continue
            # Các góc, theo vòng: a∩c, c∩b, b∩d, d∩a. Cạnh tương ứng: c, b, d, a.
            order = ((a, c), (c, b), (b, d), (d, a))
            pts = np.array([[X[i, j], Y[i, j]] for i, j in order])
            if not np.isfinite(pts).all():
                continue
            if (pts[:, 0] < -mx).any() or (pts[:, 0] > w + mx).any() or (pts[:, 1] < -my).any() or (pts[:, 1] > h + my).any():
                continue
            if not is_convex(pts) or polygon_area(pts) < min_area:
                continue
            sides = ((pts[0], pts[1], c), (pts[1], pts[2], b), (pts[2], pts[3], d), (pts[3], pts[0], a))
            covered = sum(lines[li].overlap(p, q) for p, q, li in sides)
            perimeter = sum(float(np.linalg.norm(q - p)) for p, q, _ in sides)
            if perimeter <= 0:
                continue
            out.append(Candidate(order_clockwise(pts), "lines", prescore=covered / perimeter))
    out.sort(key=lambda c: -c.prescore)
    return out[: P.PRESCORE_KEEP]


def _quad_from_contour(contour: np.ndarray) -> np.ndarray | None:
    hull = cv2.convexHull(contour)
    peri = cv2.arcLength(hull, True)
    for eps in (0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return order_clockwise(approx.reshape(4, 2))
    return order_clockwise(cv2.boxPoints(cv2.minAreaRect(hull)))


def _from_mask(mask: np.ndarray, source: str, size: tuple[int, int], top: int = 2) -> list[Candidate]:
    w, h = size
    k = max(3, round(0.02 * max(w, h)) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:top]:
        if cv2.contourArea(c) < P.MIN_AREA_RATIO * w * h:
            break
        quad = _quad_from_contour(c)
        if quad is not None and polygon_area(quad) >= P.MIN_AREA_RATIO * w * h:
            out.append(Candidate(quad, source))
    return out


def from_regions(bgr: np.ndarray, lab: np.ndarray, gray: np.ndarray) -> list[Candidate]:
    """Tách tài liệu khỏi nền bằng màu/độ sáng. Dùng khi đường thẳng không đủ (tương phản thấp, mép bị che nhiều)."""
    h, w = gray.shape
    out: list[Candidate] = []

    # Màu nền = màu trung vị của dải viền ảnh (giả định viền chủ yếu là nền).
    b = max(2, round(0.05 * min(w, h)))
    band = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
    bg = np.median(band, axis=0)
    dist = np.linalg.norm(lab - bg, axis=2)
    dist8 = np.clip(dist * (255.0 / max(float(dist.max()), 1.0)), 0, 255).astype(np.uint8)
    _, m = cv2.threshold(dist8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    out += _from_mask(m, "color", (w, h))

    _, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    out += _from_mask(bright, "bright", (w, h), top=1)
    out += _from_mask(cv2.bitwise_not(bright), "dark", (w, h), top=1)
    return out


def from_grabcut(bgr: np.ndarray) -> list[Candidate]:
    """GrabCut với khung cách mép 5% (tài liệu mục 4.1). Chậm hơn, chỉ chạy khi các cách khác chưa đủ tin cậy."""
    h, w = bgr.shape[:2]
    scale = P.GRABCUT_SIDE / max(h, w)
    small = cv2.resize(bgr, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else bgr
    sh, sw = small.shape[:2]
    mx, my = max(2, round(0.05 * sw)), max(2, round(0.05 * sh))
    mask = np.zeros((sh, sw), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(small, mask, (mx, my, sw - 2 * mx, sh - 2 * my), bgd, fgd, P.GRABCUT_ITERATIONS, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return []
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    cands = _from_mask(fg, "grabcut", (sw, sh), top=1)
    for c in cands:
        c.quad = c.quad * np.array([w / sw, h / sh], dtype=np.float32)
    return cands
