from __future__ import annotations

import numpy as np


def order_clockwise(pts: np.ndarray) -> np.ndarray:
    """4 điểm -> thứ tự theo chiều kim đồng hồ (trục y hướng xuống), bắt đầu từ điểm trên-trái nhất."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    c = pts.mean(axis=0)
    order = np.argsort(np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0]))
    pts = pts[order]
    start = int(np.argmin(pts.sum(axis=1)))
    return np.roll(pts, -start, axis=0)


def polygon_area(pts: np.ndarray) -> float:
    n = len(pts)
    return float(abs(sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))) / 2)


def is_convex(pts: np.ndarray) -> bool:
    """Đa giác (vài đỉnh) lồi khi mọi tích có hướng của các cạnh liên tiếp cùng dấu. Viết bằng vòng lặp thuần
    vì gọi hàng nghìn lần với 4 điểm — numpy chậm hơn ở kích thước này."""
    n = len(pts)
    sign = 0
    for i in range(n):
        ax, ay = pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]
        bx, by = pts[(i + 2) % n][0] - pts[(i + 1) % n][0], pts[(i + 2) % n][1] - pts[(i + 1) % n][1]
        cross = ax * by - ay * bx
        if cross == 0:
            return False
        s = 1 if cross > 0 else -1
        if sign and s != sign:
            return False
        sign = s
    return True


def angle_diff(a: float, b: float) -> float:
    """Chênh lệch giữa hai hướng đường thẳng (mod π), trong 0..π/2."""
    d = abs(a - b) % np.pi
    return float(min(d, np.pi - d))
