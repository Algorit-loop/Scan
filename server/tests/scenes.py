"""Cảnh tổng hợp để thử detect: tờ giấy trên nền, có thể kèm các thứ gây nhiễu giống ảnh ví dụ
(vân gỗ, dây cáp đè mép, gáy xoắn, góc gấp, chữ viết kín trang)."""

from __future__ import annotations

import cv2
import numpy as np

W, H = 720, 960


def quad_px(corners, w=W, h=H) -> np.ndarray:
    return np.array([[x * w, y * h] for x, y in corners], np.float32)


def wood(rng, w=W, h=H) -> np.ndarray:
    """Nền gỗ nâu: vân dọc + vài khe ván."""
    base = np.zeros((h, w, 3), np.float32)
    base[:] = (40, 75, 120)  # BGR nâu
    stripes = rng.normal(0, 1, (1, w)).astype(np.float32)
    stripes = cv2.GaussianBlur(stripes, (0, 0), 2.5)
    stripes = (stripes / (np.abs(stripes).max() + 1e-6)) * 26
    img = base + stripes[:, :, None] * np.array([0.6, 0.9, 1.2], np.float32)
    img += rng.normal(0, 5, (h, w, 3)).astype(np.float32)
    for x in rng.integers(40, w - 40, 3):  # khe ván dọc, song song với mép giấy
        cv2.line(img, (int(x), 0), (int(x + 6), h), (15, 25, 40), 3)
    return np.clip(img, 0, 255).astype(np.uint8)


def flat(color, w=W, h=H) -> np.ndarray:
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = color
    return img


def paper(img, corners, color=(238, 230, 225), text=True, lines=True, seed=0):
    """Vẽ tờ giấy (góc chuẩn hóa) có dòng kẻ và chữ viết tay giả."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    pts = quad_px(corners, w, h)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(mask, pts.astype(np.int32), 255)
    layer = np.zeros_like(img)
    layer[:] = color
    if lines:
        for y in range(0, h, 26):
            cv2.line(layer, (0, y), (w, y), (215, 200, 190), 1)
    if text:
        for _ in range(140):
            x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
            cv2.ellipse(layer, (x, y), (int(rng.integers(3, 14)), int(rng.integers(2, 9))), int(rng.integers(0, 180)), 0, int(rng.integers(120, 360)), (60, 40, 30), 2)
    out = np.where(mask[:, :, None] > 0, layer, img)
    cv2.polylines(out, [pts.astype(np.int32)], True, (200, 195, 190), 2, cv2.LINE_AA)  # mép giấy hơi sẫm
    return out


def add_rings(img, corners, n=24):
    """Gáy xoắn bên trái: các vòng kim loại sáng nhô ra khỏi mép trái."""
    h, w = img.shape[:2]
    p = quad_px(corners, w, h)
    tl, bl = p[0], p[3]
    for t in np.linspace(0.04, 0.96, n):
        c = tl + (bl - tl) * t
        cv2.ellipse(img, (int(c[0]), int(c[1])), (16, 5), 0, 0, 360, (230, 190, 120), 3, cv2.LINE_AA)
        cv2.ellipse(img, (int(c[0] + 4), int(c[1])), (7, 3), 0, 0, 360, (90, 60, 30), -1, cv2.LINE_AA)
    return img


def add_cable(img, points, thickness=6):
    """Dây cáp đen uốn cong, đè lên mép giấy."""
    pts = np.array(points, np.int32).reshape(-1, 1, 2)
    cv2.polylines(img, [pts], False, (12, 12, 14), thickness, cv2.LINE_AA)
    return img


def noise(img, sigma=6, seed=0):
    rng = np.random.default_rng(seed)
    out = img.astype(np.int16) + rng.normal(0, sigma, img.shape).astype(np.int16)
    return np.clip(out, 0, 255).astype(np.uint8)


def notebook_on_wood(seed=1):
    """Gần giống ảnh ví dụ: sổ nghiêng nhẹ, gáy xoắn bên trái, dây cáp cắt ngang mép phải, góc dưới phải bị gấp."""
    rng = np.random.default_rng(seed)
    img = wood(rng)
    corners = [(0.16, 0.30), (0.84, 0.32), (0.80, 0.78), (0.12, 0.75)]
    img = paper(img, corners, seed=seed)
    # góc dưới phải bị gấp: cắt một tam giác nền ngay tại góc
    h, w = img.shape[:2]
    br = quad_px(corners)[2]
    tri = np.array([br + (8, -70), br + (8, 8), br + (-70, 8)], np.int32)
    wood_patch = wood(np.random.default_rng(seed + 5))
    cv2.fillConvexPoly(img, tri, (0, 0, 0))
    mask = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(mask, tri, 255)
    img = np.where(mask[:, :, None] > 0, wood_patch, img)
    img = add_rings(img, corners)
    img = add_cable(img, [(600, 0), (610, 200), (640, 330), (600, 420), (650, 560), (700, 700)], 7)
    return noise(img), corners
