"""Gói kết quả từng bước của v3 cho trang /algorithms: ảnh trung gian + số liệu + so khớp với native.

Ảnh trung gian lấy từ bản soi mirror.py (cùng hàm OpenCV, cùng tham số). Bốn góc cuối cùng và ảnh nắn phẳng
lấy từ thư viện native, nên phần "kết quả" luôn là kết quả thật.
"""

from __future__ import annotations

import base64
import ctypes as C
from functools import lru_cache

import cv2
import numpy as np

from . import Params, Result, load_library, mirror

DD3_BGR = 3


@lru_cache(maxsize=1)
def _lib():
    lib = load_library()
    lib.dd3_set_num_threads(1)
    return lib


def native_params() -> dict:
    p = Params()
    _lib().dd3_default_params(C.byref(p))
    return {name: getattr(p, name) for name, _ in Params._fields_}


def native_detect(bgr: np.ndarray) -> dict:
    img = np.ascontiguousarray(bgr)
    H, W = img.shape[:2]
    p, r = Params(), Result()
    _lib().dd3_default_params(C.byref(p))
    code = _lib().dd3_detect(img.ctypes.data, W, H, int(img.strides[0]), DD3_BGR, C.byref(p), C.byref(r))
    if code != 0:
        raise ValueError(f"docdetect lỗi {code}")
    return {
        "found": bool(r.found), "reason": r.reason, "score": r.score, "confidence": r.confidence,
        "method": mirror.SOURCES[r.method] if r.found else None,
        "corners": [[r.corners[i].x, r.corners[i].y] for i in range(4)] if r.found else None,
        "candidates": r.candidates, "ms": r.ms_total,
        "coverage": list(r.coverage), "contrast": list(r.contrast),
    }


def _url(img: np.ndarray, ext: str = ".png", quality: int = 88) -> str:
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext == ".jpg" else []
    ok, buf = cv2.imencode(ext, img, params)
    if not ok:
        raise ValueError("không mã hóa được ảnh")
    mime = "image/jpeg" if ext == ".jpg" else "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf).decode()}"


def _fit(img: np.ndarray, side: int) -> np.ndarray:
    h, w = img.shape[:2]
    s = min(1.0, side / max(w, h))
    return cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img


def _zoom(img: np.ndarray, cx: float, cy: float, half: int, scale: int):
    """Cắt vùng vuông quanh (cx, cy) rồi phóng to kiểu điểm ảnh (nearest) để thấy rõ từng pixel."""
    h, w = img.shape[:2]
    x0 = int(min(max(0, round(cx) - half), max(0, w - 2 * half)))
    y0 = int(min(max(0, round(cy) - half), max(0, h - 2 * half)))
    crop = img[y0:y0 + 2 * half, x0:x0 + 2 * half]
    return cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST), x0, y0


def warp(bgr: np.ndarray, corners_norm, max_side: int = 900) -> np.ndarray:
    H, W = bgr.shape[:2]
    px = np.array(corners_norm, np.float32) * [W, H]
    top, bottom = np.linalg.norm(px[1] - px[0]), np.linalg.norm(px[2] - px[3])
    left, right = np.linalg.norm(px[3] - px[0]), np.linalg.norm(px[2] - px[1])
    ow, oh = max(top, bottom), max(left, right)
    k = min(1.0, max_side / max(ow, oh))
    ow, oh = max(1, round(ow * k)), max(1, round(oh * k))
    M = cv2.getPerspectiveTransform(px.astype(np.float32), np.float32([[0, 0], [ow, 0], [ow, oh], [0, oh]]))
    return cv2.warpPerspective(bgr, M, (ow, oh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def explain(bgr: np.ndarray) -> dict:
    P = native_params()
    nat = native_detect(bgr)
    r = mirror.run(bgr, P)
    H, W = bgr.shape[:2]
    w, h = r["w"], r["h"]
    N = lambda x, y: [round(float(x) / w, 4), round(float(y) / h, 4)]
    Q = lambda q: [N(*p) for p in q]

    out = {
        "size": {"W": W, "H": H, "w": w, "h": h},
        "params": P,
        "native": nat,
        "stats": {"sharpness": r["sharpness"], "std": r["std"], "lowContrast": bool(r.get("lowContrast"))},
        "images": {"input": _url(_fit(bgr, 720), ".jpg"), "work": _url(r["work"]), "gray": _url(r["gray"])},
    }
    if r.get("lowContrast"):
        out["mirror"] = {"found": False, "matches": not nat["found"]}
        return out

    ctx = r["ctx"]
    imgs = out["images"]
    imgs["smooth"] = _url(r["smooth"])
    L = r["lab"][..., 0]
    imgs["labL"] = _url(L)
    ab = cv2.merge([np.full_like(L, 160), r["lab"][..., 1], r["lab"][..., 2]])
    imgs["labAB"] = _url(cv2.cvtColor(ab, cv2.COLOR_Lab2BGR))
    mag = np.clip(ctx.mag / max(1e-6, float(np.percentile(ctx.mag, 99.5))) * 255, 0, 255).astype(np.uint8)
    imgs["gradient"] = _url(255 - mag)
    imgs["edgeMask"] = _url(np.where(ctx.mag >= ctx.edge_thresh, 0, 255).astype(np.uint8))
    for name, (dist8, mask, _) in r["masks"].items():
        if dist8 is not None:
            imgs["colorDist"] = _url(dist8)
        imgs[f"mask_{name}"] = _url(mask)
    imgs["canny20"], imgs["canny50"] = (_url(255 - m) for m in r["edge_maps"])

    cands = r["candidates"]
    best = r["best"]
    # Vùng phóng to cho bước đóng hình thái: giữa ứng viên tốt nhất (thường có chữ).
    cx, cy = (cands[best].quad.mean(axis=0) if best >= 0 else (w / 2, h / 2))
    for key, src in (("zoomGray", r["gray"]), ("zoomSmooth", r["smooth"])):
        z, *_ = _zoom(src, cx, cy, 24, 6)
        imgs[key] = _url(z)

    lines = []
    for ln in r["lines"]:
        p0 = ln.p + ln.d * ln.iv[0][0]
        p1 = ln.p + ln.d * ln.iv[-1][1]
        lines.append({"pts": N(*p0) + N(*p1), "covered": round(ln.covered / max(w, h), 3)})
    regions = {}
    for name, (_, _, kept) in r["masks"].items():
        regions[name] = [{"quad": Q(k["quad"]) if k["quad"] is not None else None,
                          "contour": [N(*p) for p in k["contour"].reshape(-1, 2)[:: max(1, len(k["contour"]) // 80)]],
                          "why": k["why"]} for k in kept]
    order = sorted(range(len(cands)), key=lambda i: -cands[i].rank)
    out["segments"] = [N(x0, y0) + N(x1, y1) for x0, y0, x1, y1 in r["segments"]]
    out["lines"] = lines
    out["regions"] = regions
    out["background"] = [round(float(v), 1) for v in r["background"]]
    out["edgeThresh"] = round(ctx.edge_thresh, 2)
    out["lineCandidates"] = r["line_total"]
    out["candidates"] = [{
        "i": i, "quad": Q(cands[i].quad), "source": mirror.SOURCES[cands[i].source],
        "score": round(cands[i].score, 3), "rank": round(cands[i].rank, 3), "area": round(cands[i].area, 3),
        "coverage": [round(v, 2) for v in cands[i].coverage], "contrast": [round(v, 2) for v in cands[i].contrast],
        "consistency": round(cands[i].consistency, 3), "penalized": cands[i].penalized,
    } for i in order]
    out["best"] = best

    found = "final" in r
    m = {"found": found}
    if found:
        before = cands[best].quad
        final = np.clip(r["final"], 0, [w, h])
        m.update(corners=Q(final), before=Q(before), refined=r["refine_reason"] is None, refineReason=r["refine_reason"],
                 samples=[N(x, y) + [s] for x, y, s in r["samples"]],
                 refinePoints=[[N(x, y) for x, y in side] for side in r["refine_points"]])
        # Phóng to góc dịch chuyển nhiều nhất để thấy tinh chỉnh.
        k = int(np.argmax(np.linalg.norm(r["final"] - before, axis=1)))
        z, x0, y0 = _zoom(r["gray"], *before[k], 12, 12)
        m["zoomCorner"] = {"img": _url(z), "x0": x0 / w, "y0": y0 / h, "size": [24 / w, 24 / h], "corner": k}
    if found and nat["found"]:
        m["maxDiff"] = float(np.abs(np.array(m["corners"]) - np.array(nat["corners"])).max())
    m["matches"] = found == nat["found"] and m.get("maxDiff", 0) < 0.005
    out["mirror"] = m
    if nat["found"]:
        imgs["warp"] = _url(warp(bgr, nat["corners"]), ".jpg")
    return out
