"""Đo bản soi Python (detect/v3/mirror.py) khớp thư viện native v3 tới đâu.

Từ Core/:  .venv\\Scripts\\python.exe -m tools.check_mirror --per-set 100
Ghi reports/v3-mirror-check.json; trang /algorithms hiển thị con số này cạnh hình minh họa.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time

import cv2
import numpy as np

from detect.v3 import mirror
from detect.v3.explain import native_detect, native_params
from paths import CORE_DIR, DATASET_DIR, dataset_names


def compare(bgr: np.ndarray, P: dict) -> dict:
    nat = native_detect(bgr)
    r = mirror.run(bgr, P)
    found = "final" in r
    out = {"native": nat["found"], "mirror": found}
    if found and nat["found"]:
        q = np.clip(r["final"], 0, [r["w"], r["h"]]) / [r["w"], r["h"]]
        out["maxDiff"] = float(np.abs(q - np.array(nat["corners"])).max())
    return out


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-set", type=int, default=100)
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    P = native_params()
    rng = random.Random(args.seed)
    rows = []
    for ds in dataset_names():
        labels = json.loads((DATASET_DIR / ds / "labels.json").read_text(encoding="utf-8"))
        for item in rng.sample(labels, min(args.per_set, len(labels))):
            bgr = cv2.imread(str(DATASET_DIR / ds / item["image"]), cv2.IMREAD_COLOR)
            if bgr is not None:
                rows.append({"dataset": ds, "id": item["id"], **compare(bgr, P)})
    same_found = sum(r["native"] == r["mirror"] for r in rows)
    both = [r for r in rows if "maxDiff" in r]
    close = sum(r["maxDiff"] < 0.005 for r in both)
    report = {
        "createdAt": time.strftime("%Y-%m-%d %H:%M"),
        "images": len(rows),
        "sameFound": same_found,
        "bothFound": len(both),
        "cornersWithin05pct": close,
        "mismatches": [r for r in rows if r["native"] != r["mirror"] or r.get("maxDiff", 0) >= 0.005][:50],
    }
    out = CORE_DIR / "reports" / "v3-mirror-check.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)} ảnh · cùng kết luận {same_found} · cả hai thấy {len(both)}, góc lệch < 0,5%: {close} -> {out}")


if __name__ == "__main__":
    main()
