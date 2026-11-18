"""Bản soi Python của docdetect_v3 — chỉ để MINH HỌA từng bước trên trang /algorithms.

Viết lại đúng thứ tự, công thức và tham số của native/docdetect_v3/src (detect.cpp, lines.cpp, quads.cpp,
scoring.cpp, geometry.cpp) bằng cùng các hàm OpenCV, và giữ lại mọi kết quả trung gian (ảnh, đoạn thẳng,
ứng viên, điểm từng cạnh, điểm mẫu khi tinh chỉnh) để vẽ.

Kết quả thật vẫn do thư viện C++ quyết định. `explain()` chạy cả hai và báo bản soi có khớp native không
(tools/check_mirror.py đo tỷ lệ khớp trên dataset). Khi sửa C++ phải sửa file này theo.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

LINES, COLOR, BRIGHT, DARK, EDGES = range(5)
SOURCES = ["lines", "color", "bright", "dark", "edges"]


# ---------------------------------------------------------------- hình học (geometry.cpp)

def order_clockwise(q: np.ndarray) -> np.ndarray:
    c = q.mean(axis=0)
    ang = np.arctan2(q[:, 1] - c[1], q[:, 0] - c[0])
    idx = list(np.argsort(ang, kind="stable"))
    start = 0
    for i in range(1, 4):
        if q[idx[i]].sum() < q[idx[start]].sum():
            start = i
    return np.array([q[idx[(start + i) % 4]] for i in range(4)], np.float32)


def polygon_area(q) -> float:
    s = 0.0
    for i in range(4):
        a, b = q[i], q[(i + 1) % 4]
        s += float(a[0]) * float(b[1]) - float(b[0]) * float(a[1])
    return abs(s) / 2


def is_convex(q) -> bool:
    sign = 0
    for i in range(4):
        p0, p1, p2 = q[i], q[(i + 1) % 4], q[(i + 2) % 4]
        cross = float(p1[0] - p0[0]) * float(p2[1] - p1[1]) - float(p1[1] - p0[1]) * float(p2[0] - p1[0])
        if cross == 0:
            return False
        s = 1 if cross > 0 else -1
        if sign and s != sign:
            return False
        sign = s
    return True


def angle_diff(a: float, b: float) -> float:
    d = math.fmod(abs(a - b), math.pi)
    return min(d, math.pi - d)


# ---------------------------------------------------------------- gộp đoạn thành đường (lines.cpp)

@dataclass
class Line:
    p: np.ndarray
    d: np.ndarray
    n: np.ndarray
    c: float
    angle: float = 0.0
    iv: list = field(default_factory=list)
    covered: float = 0.0

    def overlap(self, a, b) -> float:
        ta, tb = float(np.dot(a - self.p, self.d)), float(np.dot(b - self.p, self.d))
        lo, hi = min(ta, tb), max(ta, tb)
        return sum(max(0.0, min(hi, e0) - max(lo, s0)) for s0, e0 in self.iv)


def merge_segments(segs: np.ndarray, w: int, h: int, P: dict) -> list[Line]:
    side = max(w, h)
    s = []
    for x0, y0, x1, y1 in segs:
        a, b = np.array([x0, y0], float), np.array([x1, y1], float)
        ln = float(np.linalg.norm(b - a))
        if ln >= P["min_segment"] * side:
            s.append((a, b, ln))
    s.sort(key=lambda g: -g[2])

    clusters = []  # [sw, sx, sy, sxx, sxy, syy, theta, nx, ny, c, members]
    for i, (a, b, ln) in enumerate(s):
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        j = -1
        for k, c in enumerate(clusters):
            dth = math.fmod(abs(ang - c[6]), math.pi)
            dth = min(dth, math.pi - dth)
            if dth > P["merge_angle"]:
                continue
            da = abs(c[7] * a[0] + c[8] * a[1] - c[9])
            db = abs(c[7] * b[0] + c[8] * b[1] - c[9])
            if max(da, db) <= P["merge_dist"]:
                j = k
                break
        if j < 0:
            j = len(clusters)
            clusters.append([0.0] * 6 + [0.0, 0.0, 1.0, 0.0, []])
        c = clusters[j]
        c[10].append(i)
        for x, y in (a, b):
            c[0] += ln; c[1] += ln * x; c[2] += ln * y
            c[3] += ln * x * x; c[4] += ln * x * y; c[5] += ln * y * y
        mx, my = c[1] / c[0], c[2] / c[0]
        vxx, vxy, vyy = c[3] / c[0] - mx * mx, c[4] / c[0] - mx * my, c[5] / c[0] - my * my
        c[6] = 0.5 * math.atan2(2 * vxy, vxx - vyy)
        c[7], c[8] = -math.sin(c[6]), math.cos(c[6])
        c[9] = c[7] * mx + c[8] * my

    lines = []
    for c in clusters:
        ln = Line(p=np.array([c[1] / c[0], c[2] / c[0]]), d=np.array([c[8], -c[7]]), n=np.array([c[7], c[8]]), c=c[9])
        ts = []
        for i in c[10]:
            t0, t1 = float(np.dot(s[i][0] - ln.p, ln.d)), float(np.dot(s[i][1] - ln.p, ln.d))
            ts.append((min(t0, t1), max(t0, t1)))
        ts.sort()
        for t in ts:
            if ln.iv and t[0] <= ln.iv[-1][1]:
                ln.iv[-1] = (ln.iv[-1][0], max(ln.iv[-1][1], t[1]))
            else:
                ln.iv.append(t)
        ln.covered = sum(b - a for a, b in ln.iv)
        if ln.covered < P["min_line_cover"] * side:
            continue
        a = math.atan2(ln.d[1], ln.d[0])
        ln.angle = a + math.pi if a < 0 else (a - math.pi if a >= math.pi else a)
        lines.append(ln)
    lines.sort(key=lambda l: -l.covered)
    return lines[: P["max_lines"]]


# ---------------------------------------------------------------- ứng viên (quads.cpp)

@dataclass
class Candidate:
    quad: np.ndarray
    source: int
    prescore: float = 0.0
    score: float = 0.0
    coverage: list = field(default_factory=lambda: [0.0] * 4)
    contrast: list = field(default_factory=lambda: [0.0] * 4)
    consistency: float = 1.0
    area: float = 0.0
    rank: float = 0.0
    penalized: bool = False


def from_lines(lines: list[Line], w: int, h: int, P: dict) -> tuple[list[Candidate], int]:
    n = len(lines)
    if n < 4:
        return [], 0
    side = max(w, h)
    X = {}
    for i in range(n):
        for j in range(n):
            a, b = lines[i], lines[j]
            det = a.n[0] * b.n[1] - a.n[1] * b.n[0]
            if abs(det) < 1e-6:
                continue
            X[i, j] = ((a.c * b.n[1] - a.n[1] * b.c) / det, (a.n[0] * b.c - a.c * b.n[0]) / det)
    pairs = []
    for i in range(n):
        for j in range(i + 1, n):
            a, b = lines[i], lines[j]
            if angle_diff(a.angle, b.angle) > P["parallel_tol"]:
                continue
            nm = a.n if np.dot(a.n, b.n) >= 0 else -a.n
            if abs(np.dot(a.p - b.p, nm)) < P["min_side_separation"] * side:
                continue
            ang = 0.5 * math.atan2(math.sin(2 * a.angle) + math.sin(2 * b.angle),
                                   math.cos(2 * a.angle) + math.cos(2 * b.angle))
            pairs.append((i, j, ang))
    mx, my = P["corner_margin"] * w, P["corner_margin"] * h
    min_area = P["min_area_ratio"] * w * h
    out = []
    for ia in range(len(pairs)):
        for ib in range(ia + 1, len(pairs)):
            a, b, anga = pairs[ia]
            c, d, angb = pairs[ib]
            if len({a, b, c, d}) < 4 or abs(math.sin(anga - angb)) < P["min_corner_angle_sin"]:
                continue
            order = [(a, c), (c, b), (b, d), (d, a)]
            side_line = [c, b, d, a]
            q, good = [], True
            for k in order:
                if k not in X:
                    good = False
                    break
                x, y = X[k]
                if x < -mx or x > w + mx or y < -my or y > h + my:
                    good = False
                    break
                q.append((x, y))
            if not good:
                continue
            q = np.array(q, np.float32)
            if not is_convex(q) or polygon_area(q) < min_area:
                continue
            covered = perim = 0.0
            for k in range(4):
                p0, p1 = q[k].astype(float), q[(k + 1) % 4].astype(float)
                covered += lines[side_line[k]].overlap(p0, p1)
                perim += float(np.linalg.norm(p1 - p0))
            if perim <= 0:
                continue
            out.append(Candidate(order_clockwise(q), LINES,
                                 prescore=covered / perim * (polygon_area(q) / (w * h)) ** 0.2))
    total = len(out)
    out.sort(key=lambda c: -c.prescore)
    return out[: P["prescore_keep"]], total


def quad_from_contour(contour):
    hull = cv2.convexHull(contour)
    peri = cv2.arcLength(hull, True)
    for eps in (0.02, 0.03, 0.05, 0.08):
        approx = cv2.approxPolyDP(hull, eps * peri, True)
        if len(approx) == 4:
            return order_clockwise(approx.reshape(4, 2).astype(np.float32))
    return None


def from_mask(mask, source, top, P, out):
    h, w = mask.shape
    k = max(3, int(round(0.02 * max(w, h))) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    by_area = sorted(((cv2.contourArea(c), c) for c in contours), key=lambda t: -t[0])
    min_area = P["min_area_ratio"] * w * h
    kept = []
    for area, contour in by_area[:top]:
        if area < min_area:
            break
        q = quad_from_contour(contour)
        if q is None:
            kept.append({"contour": contour, "quad": None, "why": "không xấp xỉ được 4 đỉnh"})
            continue
        qa = polygon_area(q)
        fill = area / qa if qa > 0 else 0
        ok = qa >= min_area and is_convex(q) and 0.82 <= fill <= 1.18
        kept.append({"contour": contour, "quad": q, "fill": fill, "why": None if ok else f"lấp đầy {fill:.2f}"})
        if ok:
            out.append(Candidate(q, source))
    return mask, kept


def from_regions(lab8, gray, P):
    h, w = gray.shape
    b = max(2, int(round(0.05 * min(w, h))))
    band = np.ones((h, w), bool)
    band[b:h - b, b:w - b] = False
    bg = np.array([np.sort(lab8[..., k][band])[band.sum() // 2] for k in range(3)], np.float32)
    dist = np.sqrt(((lab8.astype(np.float32) - bg) ** 2).sum(axis=2))
    dist8 = cv2.convertScaleAbs(dist, alpha=255.0 / max(1.0, float(dist.max())))
    _, m = cv2.threshold(dist8, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    out = []
    masks = {}
    masks["color"] = (dist8, *from_mask(m, COLOR, 2, P, out))
    _, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    masks["bright"] = (None, *from_mask(bright, BRIGHT, 1, P, out))
    masks["dark"] = (None, *from_mask(cv2.bitwise_not(bright), DARK, 1, P, out))
    return out, masks, bg


def from_edges(gray, P):
    out = []
    maps = []
    for low in (20, 50):
        edges = cv2.Canny(gray, low, low * 3)
        edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
        maps.append(edges)
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = abs(cv2.contourArea(contour))
            if area < P["min_area_ratio"] * gray.size:
                continue
            approx = cv2.approxPolyDP(contour, 0.025 * cv2.arcLength(contour, True), True)
            if len(approx) != 4 or not cv2.isContourConvex(approx):
                continue
            q = approx.reshape(4, 2).astype(np.float32)
            qa = polygon_area(q)
            if qa < 1 or not 0.85 <= area / qa <= 1.15:
                continue
            out.append(Candidate(order_clockwise(q), EDGES, prescore=qa))
    out.sort(key=lambda c: -c.prescore)
    return out[:24], maps


# ---------------------------------------------------------------- chấm điểm (scoring.cpp)

class ScoreContext:
    def __init__(self, smooth, lab8, P):
        self.h, self.w = smooth.shape
        g = cv2.GaussianBlur(smooth.astype(np.float32), (0, 0), P["grad_sigma"])
        self.gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3, scale=1 / 8)
        self.gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3, scale=1 / 8)
        self.mag = cv2.magnitude(self.gx, self.gy)
        v = np.sort(self.mag.ravel())
        self.edge_thresh = max(4.0, 0.3 * float(v[int(0.97 * (v.size - 1))]))
        self.lab = cv2.GaussianBlur(lab8.astype(np.float32), (0, 0), P["lab_sigma"])

    def at(self, m, x, y):
        xi = min(max(int(round(x)), 0), self.w - 1)
        yi = min(max(int(round(y)), 0), self.h - 1)
        return m[yi, xi]


def _median(v):
    if not v:
        return 0.0
    v = sorted(v)
    n, m = len(v), len(v) // 2
    return v[m] if n % 2 else 0.5 * (v[m - 1] + v[m])


def side_metrics(a, b, ctx: ScoreContext, P, samples=None):
    e = b - a
    length = float(np.hypot(*e))
    if length < 1:
        return 0.0, 0.0, None
    d = e / length
    nin = np.array([-d[1], d[0]])
    k = max(4, int(length / P["sample_step"]))
    w1, h1 = ctx.w - 1.0, ctx.h - 1.0
    valid = lambda p: 0 <= p[0] <= w1 and 0 <= p[1] <= h1
    diff, cin = [], [[], [], []]
    n_assumed = 0
    cover = 0.0
    for i in range(k):
        t = P["side_trim"] + (1 - 2 * P["side_trim"]) * (0.0 if k == 1 else i / (k - 1))
        p = a + e * t
        pin, pout = p + nin * P["contrast_offset"], p - nin * P["contrast_offset"]
        in_ok, out_ok = valid(pin), valid(pout)
        border = min(p[0], p[1], w1 - p[0], h1 - p[1])
        state = "none"
        if in_ok and not out_ok and border <= P["border_touch_px"]:
            cover += P["border_credit"]
            n_assumed += 1
            state = "border"
        elif in_ok and out_ok:
            gmax = 0.0
            for o in range(-P["edge_window"], P["edge_window"] + 1):
                q = p + nin * o
                g = ctx.at(ctx.gx, *q) * nin[0] + ctx.at(ctx.gy, *q) * nin[1]
                gmax = max(gmax, abs(float(g)))
            if gmax >= ctx.edge_thresh:
                cover += 1
                state = "edge"
        if in_ok:
            ci = ctx.at(ctx.lab, *pin)
            for c in range(3):
                cin[c].append(float(ci[c]))
            if out_ok:
                diff.append(float(np.linalg.norm(ci - ctx.at(ctx.lab, *pout))))
        if samples is not None:
            samples.append((float(p[0]), float(p[1]), state))
    contrast = _median(diff)
    if n_assumed / k > 0.5:
        contrast = max(contrast, P["contrast_full"] * P["border_credit"])
    color = [_median(c) for c in cin] if cin[0] else None
    return cover / k, contrast, color


def score_quad(cand: Candidate, ctx: ScoreContext, P, samples=None):
    lens, ss, cols = [], [], []
    for i in range(4):
        a, b = cand.quad[i].astype(float), cand.quad[(i + 1) % 4].astype(float)
        cover, contrast, color = side_metrics(a, b, ctx, P, samples)
        lens.append(float(np.hypot(*(b - a))))
        cand.coverage[i] = cover
        cand.contrast[i] = min(1.0, contrast / P["contrast_full"])
        ss.append(cand.coverage[i] * cand.contrast[i])
        if color is not None:
            cols.append(np.array(color))
    mean = sum(s * l for s, l in zip(ss, lens)) / max(sum(lens), 1e-6)
    overall = 0.65 * mean + 0.35 * min(ss)
    consistency = 1.0
    if len(cols) >= 2:
        spread = max(float(np.linalg.norm(cols[i] - cols[j])) for i in range(len(cols)) for j in range(i + 1, len(cols)))
        consistency = 1 - min(0.2, max(0.0, (spread - 15) / 80))
    area = polygon_area(cand.quad) / (ctx.w * ctx.h)
    size_factor = 0.85 + 0.15 * min(1.0, area / 0.5)
    cand.consistency, cand.area = consistency, area
    cand.score = overall * consistency * size_factor
    cand.penalized = min(cand.coverage) < 0.10 or min(ss) < 0.03
    if cand.penalized:
        cand.score *= 0.5
    cand.rank = cand.score * math.sqrt(math.sqrt(max(0.0, area)))
    if cand.score < P["min_score"]:
        cand.rank -= 1


# ---------------------------------------------------------------- tinh chỉnh (refine_quad)

def refine_quad(quad: np.ndarray, gray: np.ndarray):
    """Trả (quad mới hoặc None, điểm biên mỗi cạnh, lý do bỏ qua)."""
    blurred = cv2.GaussianBlur(gray, (3, 3), 0.7)
    gx = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3, scale=1 / 8)
    gy = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3, scale=1 / 8)
    h, w = gray.shape
    fitted, all_points = [], []
    for i in range(4):
        a, b = quad[i].astype(np.float32), quad[(i + 1) % 4].astype(np.float32)
        e = b - a
        length = float(np.hypot(*e))
        if length < 8:
            return None, all_points, "cạnh quá ngắn"
        n = np.array([-e[1] / length, e[0] / length], np.float32)
        count = max(8, int(length / 2))
        points = []
        for j in range(count):
            p = a + e * (0.1 + 0.8 * j / (count - 1))
            best, selected = 4.0, None
            for offset in range(-3, 4):
                q = p + n * offset
                x, y = int(round(float(q[0]))), int(round(float(q[1])))
                if x < 1 or x >= w - 1 or y < 1 or y >= h - 1:
                    continue
                dx, dy = float(gx[y, x]), float(gy[y, x])
                normal = abs(dx * n[0] + dy * n[1])
                score = normal / (1 + 0.12 * abs(offset))
                if normal >= 0.8 * math.hypot(dx, dy) and score > best:
                    best, selected = score, q
            if best > 4:
                points.append(selected)
        all_points.append([(float(p[0]), float(p[1])) for p in points])
        if len(points) < count * 0.6:
            return None, all_points, f"cạnh {i + 1} chỉ có {len(points)}/{count} điểm biên (< 60%)"
        fitted.append(cv2.fitLine(np.array(points, np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel())
    refined = []
    for i in range(4):
        a, b = fitted[(i + 3) % 4], fitted[i]
        det = a[0] * b[1] - a[1] * b[0]
        if abs(det) < 0.1:
            return None, all_points, "hai cạnh kề gần song song"
        t = ((b[2] - a[2]) * b[1] - (b[3] - a[3]) * b[0]) / det
        p = np.array([a[2] + t * a[0], a[3] + t * a[1]], np.float32)
        if np.linalg.norm(p - quad[i]) > 5:
            return None, all_points, f"góc {i + 1} dịch {np.linalg.norm(p - quad[i]):.1f} px (> 5)"
        refined.append(p)
    refined = np.array(refined, np.float32)
    if not is_convex(refined):
        return None, all_points, "tứ giác sau tinh chỉnh không lồi"
    return refined, all_points, None


# ---------------------------------------------------------------- toàn bộ (detect.cpp)

def run(bgr: np.ndarray, P: dict) -> dict:
    """Chạy bản soi trên ảnh BGR (toàn ảnh, không ROI), trả mọi kết quả trung gian (tọa độ ảnh làm việc)."""
    H, W = bgr.shape[:2]
    scale = min(1.0, P["work_side"] / max(W, H))
    small = cv2.resize(bgr, (int(round(W * scale)), int(round(H * scale))), interpolation=cv2.INTER_AREA) \
        if scale < 1 else bgr.copy()
    h, w = small.shape[:2]
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_32F)
    r = {"work": small, "gray": gray, "w": w, "h": h, "sharpness": float(lap.std() ** 2), "std": float(gray.std())}
    if r["std"] < P["low_contrast_std"]:
        r["lowContrast"] = True
        return r
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (P["close_kernel"], P["close_kernel"]))
    smooth = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel, iterations=P["close_iterations"])
    lab8 = cv2.cvtColor(small, cv2.COLOR_BGR2Lab)
    r.update(smooth=smooth, lab=lab8)

    lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    segs = lsd.detect(smooth)[0]
    segs = segs.reshape(-1, 4) if segs is not None else np.zeros((0, 4), np.float32)
    lines = merge_segments(segs, w, h, P)
    r.update(segments=segs, lines=lines)

    ctx = ScoreContext(smooth, lab8, P)
    line_cands, line_total = from_lines(lines, w, h, P)
    region_cands, masks, bg = from_regions(lab8, gray, P)
    edge_cands, edge_maps = from_edges(smooth, P)
    cands = line_cands + region_cands + edge_cands
    for c in cands:
        score_quad(c, ctx, P)
    r.update(ctx=ctx, line_total=line_total, masks=masks, background=bg, edge_maps=edge_maps, candidates=cands)

    best = max(range(len(cands)), key=lambda i: cands[i].rank, default=-1) if cands else -1
    # C++ chọn phần tử đầu tiên khi bằng điểm (so sánh >); max() của Python cũng giữ phần tử đầu.
    r["best"] = best
    if best < 0 or cands[best].score < P["min_score"]:
        return r
    winner = cands[best]
    samples = []
    score_quad(Candidate(winner.quad.copy(), winner.source), ctx, P, samples)
    refined, points, why = refine_quad(winner.quad, gray)
    r.update(samples=samples, refine_points=points, refine_reason=why,
             final=refined if refined is not None else winner.quad)
    return r
