"""Tìm đoạn thẳng (LSD) rồi gộp các đoạn thẳng hàng thành đường dài.

Đường được gộp dù bị ngắt quãng (dây tai nghe đè lên mép), nên không cần contour khép kín.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import params as P


@dataclass
class Line:
    p: np.ndarray                  # một điểm trên đường (trọng tâm)
    d: np.ndarray                  # hướng đơn vị
    n: np.ndarray                  # pháp tuyến đơn vị
    c: float                       # n·x = c với mọi x trên đường
    angle: float                   # hướng, trong [0, π)
    intervals: list[tuple[float, float]]  # các khoảng tham số t (dọc d, tính từ p) thực sự có cạnh
    covered: float                 # tổng độ dài các khoảng

    def endpoints(self) -> tuple[np.ndarray, np.ndarray]:
        return self.p + self.d * self.intervals[0][0], self.p + self.d * self.intervals[-1][1]

    def overlap(self, a: np.ndarray, b: np.ndarray) -> float:
        """Độ dài phần cạnh a→b (nằm trên đường này) được các đoạn thật phủ lên."""
        ta, tb = float((a - self.p) @ self.d), float((b - self.p) @ self.d)
        lo, hi = min(ta, tb), max(ta, tb)
        return sum(max(0.0, min(hi, e) - max(lo, s)) for s, e in self.intervals)


def detect_segments(gray: np.ndarray) -> np.ndarray:
    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    segs = lsd.detect(gray)[0]
    return np.zeros((0, 4), np.float32) if segs is None else segs.reshape(-1, 4)


def _union(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for s, e in sorted(intervals):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]


def merge_segments(segs: np.ndarray, size: tuple[int, int]) -> list[Line]:
    w, h = size
    side = max(w, h)
    a, b = segs[:, :2], segs[:, 2:]
    length = np.linalg.norm(b - a, axis=1)
    keep = length >= P.MIN_SEGMENT * side
    a, b, length = a[keep], b[keep], length[keep]
    if len(a) == 0:
        return []
    order = np.argsort(-length)
    a, b, length = a[order], b[order], length[order]

    # Mỗi cụm giữ các tổng có trọng số (độ dài) để khớp lại đường sau mỗi lần thêm đoạn.
    cap = len(a)
    sw = np.zeros(cap); sx = np.zeros(cap); sy = np.zeros(cap)
    sxx = np.zeros(cap); sxy = np.zeros(cap); syy = np.zeros(cap)
    theta = np.zeros(cap); nx = np.zeros(cap); ny = np.zeros(cap); cc = np.zeros(cap)
    members: list[list[int]] = []

    def fit(k: int) -> None:
        mx, my = sx[k] / sw[k], sy[k] / sw[k]
        vxx, vxy, vyy = sxx[k] / sw[k] - mx * mx, sxy[k] / sw[k] - mx * my, syy[k] / sw[k] - my * my
        theta[k] = 0.5 * np.arctan2(2 * vxy, vxx - vyy)
        nx[k], ny[k] = -np.sin(theta[k]), np.cos(theta[k])
        cc[k] = nx[k] * mx + ny[k] * my

    for i in range(len(a)):
        k_n = len(members)
        j = -1
        if k_n:
            ang = np.arctan2(b[i, 1] - a[i, 1], b[i, 0] - a[i, 0])
            dth = np.abs(ang - theta[:k_n]) % np.pi
            dth = np.minimum(dth, np.pi - dth)
            da = np.abs(nx[:k_n] * a[i, 0] + ny[:k_n] * a[i, 1] - cc[:k_n])
            db = np.abs(nx[:k_n] * b[i, 0] + ny[:k_n] * b[i, 1] - cc[:k_n])
            ok = (dth <= P.MERGE_ANGLE) & (np.maximum(da, db) <= P.MERGE_DIST)
            if ok.any():
                j = int(np.argmax(ok))
        if j < 0:
            j = k_n
            members.append([])
        members[j].append(i)
        for pt in (a[i], b[i]):
            w_ = length[i]
            sw[j] += w_; sx[j] += w_ * pt[0]; sy[j] += w_ * pt[1]
            sxx[j] += w_ * pt[0] ** 2; sxy[j] += w_ * pt[0] * pt[1]; syy[j] += w_ * pt[1] ** 2
        fit(j)

    lines: list[Line] = []
    for k, idx in enumerate(members):
        p = np.array([sx[k] / sw[k], sy[k] / sw[k]])
        d = np.array([ny[k], -nx[k]])
        ts = [(float((a[i] - p) @ d), float((b[i] - p) @ d)) for i in idx]
        iv = _union([(min(t), max(t)) for t in ts])
        covered = sum(e - s for s, e in iv)
        if covered < P.MIN_LINE_COVER * side:
            continue
        ang = float(np.arctan2(d[1], d[0]) % np.pi)
        lines.append(Line(p, d, np.array([nx[k], ny[k]]), float(cc[k]), ang, iv, covered))

    lines.sort(key=lambda ln: -ln.covered)
    return lines[: P.MAX_LINES]
