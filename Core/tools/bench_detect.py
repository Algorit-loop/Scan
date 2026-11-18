"""So sánh nhanh tốc độ + độ chính xác giữa các phiên bản detect trên cùng một mẫu ảnh.

    .venv\\Scripts\\python.exe -m tools.bench_detect                         # v1 vs v2, 60 ảnh/bộ, letterbox 256
    .venv\\Scripts\\python.exe -m tools.bench_detect --versions v2 --n 300

Đầu vào giống tools/evaluate.py (letterbox SIZE×SIZE). In thời gian trung vị / p95 và Mean IoU.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import cv2
import numpy as np

from detect import imaging
from detect import detect_in_roi, get_detector
from tools import evaluate as E


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--versions", nargs="+", default=["v1", "v2"])
    ap.add_argument("--n", type=int, default=60, help="số ảnh mỗi bộ")
    ap.add_argument("--size", type=int, default=256)
    a = ap.parse_args()
    E.SIZE = a.size

    for ds in E.DATASETS:
        labels = json.loads((E.DATASET_DIR / ds / "labels.json").read_text(encoding="utf-8"))
        pos = [r for r in labels if r["found"]]
        labels = pos[:: max(1, len(pos) // a.n)][: a.n]  # rải đều trong ảnh có tài liệu
        imgs = []
        for r in labels:
            img = cv2.imread(str(E.DATASET_DIR / ds / r["image"]))
            imgs.append((r, img, *imaging.letterbox(img, a.size)))
        print(f"\n{ds} · {len(imgs)} ảnh · letterbox {a.size}")
        for v in a.versions:
            det = get_detector(v)
            detect_in_roi(det, imgs[0][2], imgs[0][3])  # làm nóng
            ms, ious = [], []
            for r, img, boxed, roi in imgs:
                t0 = time.perf_counter()
                res = detect_in_roi(det, boxed, roi)
                ms.append((time.perf_counter() - t0) * 1000)
                h, w = img.shape[:2]
                pred = E.quad_list(res["corners"]) if res["found"] else None
                ious.append(E.iou(pred, r["corners"], w, h) if pred else 0.0)
            ms, ious = np.array(ms), np.array(ious)
            print(f"  {v:4s}  trung vị {np.median(ms):7.1f} ms   p95 {np.percentile(ms, 95):7.1f} ms   "
                  f"Mean IoU {ious.mean():.3f}   Success@0.9 {(ious >= 0.9).mean():.1%}")


if __name__ == "__main__":
    main()
