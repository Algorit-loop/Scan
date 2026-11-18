"""Đánh giá một phiên bản detect trên dataset/ và ghi kết quả vào results/<version>@<size>/<dataset>.json.

Chạy từ thư mục Core/:

    .venv\\Scripts\\python.exe -m tools.evaluate                       # v1, cả 3 bộ
    .venv\\Scripts\\python.exe -m tools.evaluate --dataset SmartDoc --limit 200

Quy trình mỗi ảnh (giống đầu vào của một model thực tế):
  1. Đọc ảnh gốc (BGR).
  2. Normalize: letterbox về SIZE×SIZE (mặc định 256×256, đổi bằng --size) — thu nhỏ giữ tỉ lệ, phần thừa tô xám (114). Không cần "input tensor"
     cho detect cổ điển (OpenCV làm việc trực tiếp trên ảnh uint8); tensor NCHW float 0..1 chỉ cần khi dùng
     model mạng nơ-ron — xem `to_tensor()` để dùng sau.
  3. Detect trên ảnh đã letterbox, chỉ trong vùng ảnh thật (roi) — dải viền xám bị bỏ qua, nếu không detect
     dễ nhận nhầm dải viền là tài liệu. Đo thời gian (chỉ bước detect).
  4. Tọa độ chuẩn hóa theo roi = tọa độ chuẩn hóa trên ảnh gốc; so với đáp án.

Chỉ số:
  - IoU (Jaccard) giữa tứ giác dự đoán và đáp án — chỉ số chuẩn của SmartDoc. Không tìm thấy = 0.
  - Success@0.9: tỉ lệ ảnh có IoU ≥ 0.9 ("dùng được ngay").
  - Sai số góc: khoảng cách trung bình 4 góc / đường chéo ảnh (%).
  - Ảnh không có tài liệu: tỉ lệ báo nhầm (false positive).
  - Hiệu năng: thời gian detect trung vị / p95 (ms) và FPS = 1000 / trung vị.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime

import cv2
import numpy as np

from detect import imaging
from detect import detect_in_roi, get_detector
from detect.metrics import SUCCESS_IOU, quad_jaccard, summarize
from paths import DATASET_DIR, RESULT_DIR, dataset_names

DATASETS = dataset_names()
SIZE = imaging.LETTERBOX_SIZE  # cạnh ảnh vuông sau letterbox; đổi bằng --size
PAD = imaging.LETTERBOX_PAD


def run_key(version: str, size: int) -> str:
    """Tên thư mục kết quả, vd. v2@256 — tách theo cỡ để so 256 với 640."""
    return f"{version}@{size}"


def to_tensor(img: np.ndarray) -> np.ndarray:
    """Ảnh BGR uint8 -> tensor 1×3×H×W float32 RGB 0..1 (cho model mạng nơ-ron sau này; detect cổ điển không dùng)."""
    return np.ascontiguousarray(img[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255.0


def quad_list(corners: list[dict]) -> list[list[float]]:
    return [[round(c["x"], 5), round(c["y"], 5)] for c in corners]


def iou(pred: list, gt: list, w: int, h: int) -> float:
    grid = (1000, max(1, round(1000 * h / w))) if w >= h else (max(1, round(1000 * w / h)), 1000)
    return quad_jaccard([{"x": x, "y": y} for x, y in pred], [{"x": x, "y": y} for x, y in gt], grid)


def corner_err(pred: list, gt: list, w: int, h: int) -> float:
    d = np.hypot(w, h)
    return float(np.mean([np.hypot((p[0] - g[0]) * w, (p[1] - g[1]) * h) for p, g in zip(pred, gt)]) / d)


def evaluate(version: str, dataset: str, limit: int | None, progress: bool = False) -> None:
    """progress=True: in dòng `@@PROGRESS {...}` cho trang web (web/eval_runner.py) đọc."""
    detector = get_detector(version)
    base = DATASET_DIR / dataset
    labels = json.loads((base / "labels.json").read_text(encoding="utf-8"))
    if limit:
        labels = labels[:: max(1, len(labels) // limit)][:limit]
    detector.detect(np.full((SIZE, SIZE, 3), PAD, np.uint8))  # làm nóng

    def report(done: int) -> None:
        print("@@PROGRESS " + json.dumps({"dataset": dataset, "done": done, "total": len(labels)}), flush=True)

    if progress:
        report(0)

    items = []
    t_start = time.perf_counter()
    for n, rec in enumerate(labels, 1):
        img = cv2.imread(str(base / rec["image"]), cv2.IMREAD_COLOR)
        if img is None:
            print("  bỏ qua ảnh hỏng:", rec["image"])
            continue
        h, w = img.shape[:2]
        boxed, roi = imaging.letterbox(img, SIZE)
        t0 = time.perf_counter()
        res = detect_in_roi(detector, boxed, roi)
        ms = (time.perf_counter() - t0) * 1000
        pred = quad_list(res["corners"]) if res["found"] else None
        gt = rec["corners"]
        item = {
            "id": rec["id"], "image": rec["image"], "width": w, "height": h, "group": rec.get("group"),
            "gtFound": rec["found"], "gt": gt, "found": res["found"], "pred": pred,
            "confidence": round(res.get("confidence", 0.0), 3), "method": res.get("method") or res.get("reason"),
            "iou": None, "cornerErr": None, "ms": round(ms, 1),
        }
        if rec["found"]:
            item["iou"] = round(iou(pred, gt, w, h), 4) if pred else 0.0
            item["cornerErr"] = round(corner_err(pred, gt, w, h), 4) if pred else None
        items.append(item)
        if progress and (n % 10 == 0 or n == len(labels)):
            report(n)
        if not progress and n % 250 == 0:
            el = time.perf_counter() - t_start
            print(f"  {dataset}: {n}/{len(labels)} · còn ~{el / n * (len(labels) - n) / 60:.0f} phút", flush=True)

    groups = {}
    for g in sorted({i["group"] for i in items if i["group"]}):
        sub = summarize([i for i in items if i["group"] == g])
        groups[g] = {k: sub[k] for k in ("images", "meanIoU", "success", "foundRate", "falsePositive", "msMedian")}
    out = {
        "run": run_key(version, SIZE), "version": version, "detector": detector.name, "dataset": dataset,
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "normalize": {"size": SIZE, "letterbox": True, "padValue": PAD, "ignorePadding": True, "tensor": False},
        "successIoU": SUCCESS_IOU,
        "summary": summarize(items), "groups": groups, "items": items,
    }
    path = RESULT_DIR / run_key(version, SIZE) / f"{dataset}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")  # ghi file tạm rồi đổi tên: dừng giữa chừng không làm hỏng kết quả cũ
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    sm = out["summary"]
    print(f"  -> {path}: IoU {sm['meanIoU']} · success {sm['success']} · {sm['msMedian']} ms")


def main() -> None:
    global SIZE
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default="v1")
    ap.add_argument("--dataset", choices=DATASETS, action="append", help="lặp lại được; mặc định mọi bộ trong dataset/")
    ap.add_argument("--limit", type=int, help="chỉ lấy N ảnh rải đều (chạy thử nhanh)")
    ap.add_argument("--size", type=int, default=SIZE, help=f"cạnh ảnh sau letterbox (mặc định {SIZE})")
    ap.add_argument("--progress", action="store_true", help="in tiến độ dạng máy đọc (dùng bởi trang web)")
    a = ap.parse_args()
    SIZE = a.size
    for ds in a.dataset or DATASETS:
        print(f"Đánh giá {a.version} trên {ds} · letterbox {SIZE}×{SIZE}")
        evaluate(a.version, ds, a.limit, a.progress)


if __name__ == "__main__":
    main()
