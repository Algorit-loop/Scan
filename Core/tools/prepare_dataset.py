"""Chuẩn hóa 3 bộ dữ liệu ở dataset/_raw/ thành dataset/<tên>/ để đo độ chính xác của detect/vN.

Chạy từ thư mục Core/ (cần `pip install -r requirements-dev.txt`):

    .venv\\Scripts\\python.exe -m tools.prepare_dataset                 # cả 3 bộ
    .venv\\Scripts\\python.exe -m tools.prepare_dataset --only smartdoc # một bộ
    .venv\\Scripts\\python.exe -m tools.prepare_dataset --doccorner-splits test val --smartdoc-stride 5

dataset/_raw/ chỉ được đọc, không bị sửa. Mỗi bộ trong dataset/<tên>/ có cùng cấu trúc:

    images/<id>.jpg   ảnh
    labels.json       list các bản ghi:
        {"id", "image", "width", "height", "found", "corners", "group", "split"?}
      - corners: 4 góc [x, y] chuẩn hóa 0..1, thứ tự TL, TR, BR, BL (khác kết quả detector là {x, y};
        chuyển bằng {"x": x, "y": y}). found=false (ảnh không có tài liệu) thì corners = null.
      - group: nhóm để thống kê theo nhóm (nguồn ảnh / nền / loại tài liệu).
    README.md         nguồn, giấy phép, cách tạo, ghi chú.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import cv2
import numpy as np

from detect.imaging import order_corners
from paths import DATASET_DIR, RAW_DIR

RAW = RAW_DIR
OUT = DATASET_DIR


def quad_record(corners_px: np.ndarray, w: int, h: int) -> list[list[float]]:
    """4 điểm pixel (thứ tự bất kỳ) -> 4 góc chuẩn hóa TL, TR, BR, BL."""
    q = order_corners(corners_px) / np.array([w, h], dtype=np.float32)
    return [[round(float(x), 6), round(float(y), 6)] for x, y in q]


def ext_of(data: bytes) -> str:
    return "png" if data[:4] == b"\x89PNG" else "jpg"


class Writer:
    def __init__(self, name: str):
        self.dir = OUT / name
        if self.dir.exists():
            shutil.rmtree(self.dir)
        (self.dir / "images").mkdir(parents=True)
        self.records: list[dict] = []

    def add(self, rid: str, data: bytes, ext: str, w: int, h: int, corners: list[list[float]] | None, group: str, **extra) -> None:
        rel = f"images/{rid}.{ext}"
        (self.dir / rel).write_bytes(data)
        self.records.append({"id": rid, "image": rel, "width": w, "height": h, "found": corners is not None,
                             "corners": corners, "group": group, **extra})

    def finish(self, readme: str) -> None:
        (self.dir / "labels.json").write_text(json.dumps(self.records, ensure_ascii=False), encoding="utf-8")
        pos = sum(r["found"] for r in self.records)
        stats = f"\n## Thống kê\n\n- Tổng số ảnh: {len(self.records)} (có tài liệu: {pos}, không có: {len(self.records) - pos})\n"
        (self.dir / "README.md").write_text(readme.rstrip() + "\n" + stats, encoding="utf-8")
        print(f"  -> {self.dir}: {len(self.records)} ảnh")


# ---------------------------------------------------------------- DocCornerDataset (Hugging Face, parquet)
def prepare_doccorner(splits: list[str]) -> None:
    import pyarrow.parquet as pq

    print("DocCornerDataset, splits:", ", ".join(splits))
    w = Writer("DocCorner")
    keys = ["tl", "tr", "br", "bl"]
    for split in splits:
        folder = RAW / "DocCornerDataset" / split
        if not folder.is_dir():
            sys.exit(f"Không thấy {folder}")
        for pf in sorted(folder.glob("*.parquet")):
            for batch in pq.ParquetFile(pf).iter_batches(batch_size=200):
                for r in batch.to_pylist():
                    data = r["image"]["bytes"]
                    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
                    if img is None:
                        print("  bỏ qua ảnh hỏng:", r["filename"])
                        continue
                    h, wd = img.shape[:2]
                    corners = None
                    if not r["is_negative"]:
                        pts = np.array([[r[f"corner_{k}_x"] * wd, r[f"corner_{k}_y"] * h] for k in keys], np.float32)
                        corners = quad_record(pts, wd, h)
                    stem = Path(r["filename"]).stem
                    group = stem.rsplit("_", 1)[0]  # nguồn ảnh, vd midv500, idcard_final_polygon
                    w.add(f"{split}_{stem}", data, ext_of(data), wd, h, corners, group, split=split)
            print(f"  {pf.relative_to(RAW)} xong")
    w.finish("""# DocCorner

Nguồn: `dataset/_raw/DocCornerDataset` (Hugging Face, 4 góc tài liệu, parquet). Ảnh có sẵn góc chuẩn hóa
TL, TR, BR, BL; ảnh `is_negative` không chứa tài liệu (`found=false`).

- `group`: nguồn ảnh gốc (tiền tố tên file: midv500, idcard_final_polygon, book_page_segmentation, ...).
- `split`: split gốc của bộ dữ liệu. Mặc định chỉ lấy `test` (detect v1 không huấn luyện nên không cần train).
- Ảnh được giữ nguyên byte gốc (không nén lại).
""")


# ---------------------------------------------------------------- Roboflow "document corners" (YOLOv8 zip)
def prepare_roboflow() -> None:
    print("Roboflow document-corners")
    zpath = RAW / "document corners.v3i.yolov8.zip"
    w = Writer("RoboflowCorners")
    kinds = {"bbox": 0, "polygon4": 0, "polygonN": 0, "empty": 0}
    with zipfile.ZipFile(zpath) as z:
        names = set(z.namelist())
        for name in sorted(n for n in names if "/images/" in n and not n.endswith("/")):
            split, _, fn = name.split("/", 2)
            split = {"valid": "val"}.get(split, split)
            label = name.replace("/images/", "/labels/").rsplit(".", 1)[0] + ".txt"
            data = z.read(name)
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                print("  bỏ qua ảnh hỏng:", name)
                continue
            h, wd = img.shape[:2]
            rows = [ln.split() for ln in z.read(label).decode().splitlines() if ln.strip()] if label in names else []
            corners = None
            group = "none"
            if not rows:
                kinds["empty"] += 1
            else:
                vals = np.array(rows[0][1:], np.float64)  # tài liệu đầu tiên (mỗi ảnh một tài liệu)
                if len(vals) == 4:  # cx cy w h — chỉ có hộp chữ nhật, không có góc thật
                    cx, cy, bw, bh = vals
                    pts = np.array([[cx - bw / 2, cy - bh / 2], [cx + bw / 2, cy - bh / 2],
                                    [cx + bw / 2, cy + bh / 2], [cx - bw / 2, cy + bh / 2]]) * [wd, h]
                    kinds["bbox"] += 1
                    group = "bbox"
                else:  # polygon x1 y1 x2 y2 ...
                    poly = (vals.reshape(-1, 2) * [wd, h]).astype(np.float32)
                    if len(poly) == 4:
                        pts = poly
                        kinds["polygon4"] += 1
                        group = "polygon"
                    else:
                        pts = cv2.boxPoints(cv2.minAreaRect(poly))
                        kinds["polygonN"] += 1
                        group = "polygon"
                corners = quad_record(np.asarray(pts, np.float32), wd, h)
            stem = Path(fn).stem
            w.add(f"{split}_{stem}", data, ext_of(data), wd, h, corners, group, split=split)
    print("  loại nhãn:", kinds)
    w.finish(f"""# RoboflowCorners

Nguồn: `dataset/_raw/document corners.v3i.yolov8.zip` (Roboflow Universe, brilliantflux/document-corners v3, CC BY 4.0).

**Lưu ý độ chính xác của nhãn:** loại nhãn trong bộ này: {kinds}.
Nhãn dạng `bbox` là hộp chữ nhật song song trục, đổi thành tứ giác 4 góc — chỉ đúng khi tài liệu nằm thẳng;
với tài liệu bị xoay/nghiêng thì Jaccard so với nhãn này bị chặn trên. Nhãn `polygonN` (nhiều hơn 4 điểm)
được xấp xỉ bằng hình chữ nhật xoay nhỏ nhất. `group` = `bbox` / `polygon` theo loại nhãn gốc (`none` nếu không có nhãn).
Ảnh không có nhãn → `found=false`. `split`: train / val / test của bộ gốc (gộp cả ba vì bộ nhỏ).
""")


# ---------------------------------------------------------------- SmartDoc Challenge 1 (video + gt.xml)
def prepare_smartdoc(stride: int) -> None:
    print(f"SmartDoc ch1, mỗi {stride} khung lấy 1")
    tmp = Path(tempfile.mkdtemp(prefix="smartdoc_"))
    try:
        with tarfile.open(RAW / "testDataset.tar.gz") as t:
            t.extractall(tmp, filter="data")
        base = tmp / "testDataset"
        w = Writer("SmartDoc")
        for xml in sorted(base.glob("background*/*.gt.xml")):
            bg = xml.parent.name
            vid = xml.name.removesuffix(".gt.xml")
            doctype = vid.rstrip("0123456789")
            gt = {int(f.get("index")): f for f in ET.parse(xml).getroot().iter("frame")}
            cap = cv2.VideoCapture(str(xml.with_name(vid + ".avi")))
            if not cap.isOpened():
                sys.exit(f"Không mở được video {vid}.avi (OpenCV thiếu codec?)")
            idx = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                idx += 1
                if (idx - 1) % stride:
                    continue
                f = gt.get(idx)
                if f is None:
                    continue
                h, wd = frame.shape[:2]
                if f.get("rejected") == "true":
                    continue  # khung bị loại khỏi đáp án (tài liệu không nhìn rõ) -> không đo
                pts = np.array([[float(p.get("x")), float(p.get("y"))] for p in f.iter("point")], np.float32)
                ok2, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                w.add(f"{bg}_{vid}_{idx:04d}", buf.tobytes(), "jpg", wd, h, quad_record(pts, wd, h), doctype,
                      background=bg, video=f"{bg}/{vid}", frame=idx)
            cap.release()
            print(f"  {bg}/{vid} xong")
        w.finish(f"""# SmartDoc

Nguồn: `dataset/_raw/testDataset.tar.gz` (ICDAR 2015 SmartDoc Challenge 1: 150 video, 5 nền x 6 loại tài liệu x 5 video,
đáp án 4 góc từng khung trong `*.gt.xml`).

- Mỗi video lấy 1 khung mỗi {stride} khung (khung 1, {1 + stride}, ...), lưu JPEG chất lượng 92; khung bị đánh dấu `rejected` trong đáp án bị bỏ.
- `group`: loại tài liệu (datasheet, letter, magazine, paper, patent, tax). Trường thêm: `background` (background01..05), `video`, `frame` (đếm từ 1).
- Đổi `--smartdoc-stride` (script `Core/tools/prepare_dataset.py`) để lấy dày/thưa hơn.
""")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", choices=["doccorner", "roboflow", "smartdoc"], action="append", help="chỉ chạy bộ này (lặp lại được)")
    ap.add_argument("--doccorner-splits", nargs="+", default=["test"], choices=["train", "val", "test"])
    ap.add_argument("--smartdoc-stride", type=int, default=10)
    a = ap.parse_args()
    todo = a.only or ["doccorner", "roboflow", "smartdoc"]
    if "doccorner" in todo:
        prepare_doccorner(a.doccorner_splits)
    if "roboflow" in todo:
        prepare_roboflow()
    if "smartdoc" in todo:
        prepare_smartdoc(a.smartdoc_stride)


if __name__ == "__main__":
    main()
