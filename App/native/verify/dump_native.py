"""Chuẩn bị dữ liệu đối chiếu wasm ↔ native cho docdetect_v3.

Lấy ảnh thật từ Core/dataset, đưa về RGBA ở hai cỡ (cạnh dài 384 như khung detect trong app, và cỡ gốc
như lúc chụp), chạy dd3_detect bằng DLL native (Core/native/docdetect_v3/build), ghi:
  <out>/<i>.rgba   điểm ảnh RGBA thô
  <out>/cases.json kích thước + kết quả native
Chạy từ thư mục gốc:  Core\.venv\Scripts\python.exe App\native\verify\dump_native.py --per-set 40
"""

from __future__ import annotations

import argparse
import ctypes as C
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "Core"))
from detect.v3 import Params, Result, load_library  # noqa: E402

DD3_RGBA = 5
SETS = ["DocCorner", "RoboflowCorners", "SmartDoc"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-set", type=int, default=40)
    ap.add_argument("--out", default=str(REPO / ".tmp" / "wasm-verify"))
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.rgba"):
        f.unlink()

    lib = load_library()
    lib.dd3_set_num_threads(1)
    params = Params()
    lib.dd3_default_params(C.byref(params))

    rng = random.Random(args.seed)
    cases = []
    for name in SETS:
        labels = json.loads((REPO / "Core" / "dataset" / name / "labels.json").read_text(encoding="utf-8"))
        for item in rng.sample(labels, min(args.per_set, len(labels))):
            bgr = cv2.imread(str(REPO / "Core" / "dataset" / name / item["image"]), cv2.IMREAD_COLOR)
            if bgr is None:
                continue
            h, w = bgr.shape[:2]
            k = 384 / max(w, h)
            sizes = [("full", bgr)]
            if k < 1:
                small = cv2.resize(bgr, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
                sizes.insert(0, ("384", small))
            for size, img in sizes:
                rgba = np.ascontiguousarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGBA))
                ih, iw = rgba.shape[:2]
                r = Result()
                status = lib.dd3_detect(rgba.ctypes.data, iw, ih, iw * 4, DD3_RGBA, C.byref(params), C.byref(r))
                idx = len(cases)
                rgba.tofile(out / f"{idx}.rgba")
                cases.append({
                    "file": f"{idx}.rgba", "set": name, "id": item["id"], "size": size, "w": iw, "h": ih,
                    "status": status, "found": bool(r.found), "reason": r.reason, "score": r.score,
                    "corners": [v for p in r.corners for v in (p.x, p.y)], "ms": r.ms_total,
                })
    (out / "cases.json").write_text(json.dumps(cases), encoding="utf-8")
    print(f"{len(cases)} ca -> {out}")


if __name__ == "__main__":
    main()
