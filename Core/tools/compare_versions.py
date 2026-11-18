"""Paired, reproducible comparison; keeps development/validation images apart.

Run from Core: .venv/Scripts/python.exe -m tools.compare_versions --phase validation
Outputs do not replace the web's existing evaluation runs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import platform
import os
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from detect import get_detector, detect_in_roi, imaging
from detect.metrics import summarize
from paths import CORE_DIR, DATASET_DIR, dataset_names
from tools.evaluate import iou, quad_list, corner_err


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def select(dataset: str, records: list[dict], phase: str, limit: int) -> list[dict]:
    def development(r):
        if dataset == "RoboflowCorners":
            return r.get("split") == "train"
        # Adjacent SmartDoc frames from one video must stay together.
        return int(digest(r.get("video") or r["id"])[:8], 16) % 2 == 0
    pool = [r for r in records if phase == "all" or development(r) == (phase == "development")]
    # Preserve rare negatives; cap them at 25% of the requested sample.
    ordered = sorted(pool, key=lambda r: digest(r["id"]))
    if not limit:
        return ordered
    neg = [r for r in ordered if not r["found"]][:max(1, limit // 4)]
    pos = [r for r in ordered if r["found"]][:limit - len(neg)]
    return sorted(pos + neg, key=lambda r: digest(r["id"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--versions", nargs="+", default=["v2", "v3"])
    ap.add_argument("--phase", choices=["development", "validation", "all"], default="development")
    ap.add_argument("--limit", type=int, default=300, help="per dataset; 0 = all")
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--output", type=Path, default=Path("reports/comparison.json"))
    args = ap.parse_args()
    detectors = {v: get_detector(v) for v in args.versions}
    report = {"phase": args.phase, "size": args.size, "limit": args.limit,
              "createdAt": datetime.now(timezone.utc).isoformat(),
              "environment": {"platform": platform.platform(), "machine": platform.machine(),
                              "python": platform.python_version(), "opencvPython": cv2.__version__,
                              "threads": os.environ.get("DOCDETECT_THREADS", "1")},
              "nativeSources": {v: {p.name: digest(p.read_text(encoding="utf-8"))
                               for p in sorted((CORE_DIR / "native" / ("docdetect" if v == "v2" else "docdetect_" + v) / "src").glob("*"))}
                                for v in args.versions},
              "timing": "detect + Python adapter; excludes decode and letterbox; warmed with a real image",
              "split": "Roboflow: train vs val/test; others: SHA256(id or SmartDoc video) parity. Not an independent external test set.",
              "datasets": {}}
    for ds in dataset_names():
        records = json.loads((DATASET_DIR / ds / "labels.json").read_text(encoding="utf-8"))
        rows = select(ds, records, args.phase, args.limit)
        items = {v: [] for v in detectors}
        for idx, r in enumerate(rows):
            img = cv2.imread(str(DATASET_DIR / ds / r["image"]))
            if img is None:
                raise RuntimeError(f"Unreadable image: {ds}/{r['image']}")
            boxed, roi = imaging.letterbox(img, args.size)
            h, w = img.shape[:2]
            for v in (args.versions if idx % 2 == 0 else args.versions[::-1]):
                det = detectors[v]
                if idx == 0:
                    for _ in range(3):
                        detect_in_roi(det, boxed, roi)
                start = time.perf_counter()
                res = detect_in_roi(det, boxed, roi)
                ms = (time.perf_counter() - start) * 1000
                pred = quad_list(res["corners"]) if res["found"] else None
                items[v].append({"id": r["id"], "image": r["image"], "gtFound": r["found"],
                    "found": res["found"], "pred": pred,
                    "iou": (iou(pred, r["corners"], w, h) if pred else 0) if r["found"] else None,
                    "cornerErr": corner_err(pred, r["corners"], w, h) if pred and r["found"] else None,
                    "ms": ms, "debug": res.get("debug", {})})
        report["datasets"][ds] = {v: {"summary": summarize(data), "items": data} for v, data in items.items()}
        for v, data in report["datasets"][ds].items():
            print(ds, v, json.dumps(data["summary"], ensure_ascii=True), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
