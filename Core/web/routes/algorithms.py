"""Algorithm documentation: live native defaults and paired validation results."""
from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter

import cv2
from fastapi import HTTPException

import detect
from paths import CORE_DIR, DATASET_DIR
from .. import results

router = APIRouter(prefix="/api/algorithms")

# Ảnh ví dụ cho phần "từng bước": mỗi ảnh cho thấy một tình huống khác nhau.
STEP_EXAMPLES = [
    ("SmartDoc", "background01_magazine004_0191", "Tạp chí trên bàn gỗ"),
    ("SmartDoc", "background05_patent005_0021", "Nền nhiều đồ vật"),
    ("DocCorner", "test_receipt_detection_9exb2_000234", "Hóa đơn"),
    ("DocCorner", "test_id_card_skew_000709", "Thẻ chụp nghiêng"),
    ("DocCorner", "test_negative_coco_train_005319", "Không có tài liệu"),
    ("DocCorner", "test_negative_coco_train_009741", "Báo nhầm"),
]


@router.get("/steps")
def steps(ds: str | None = None, id: str | None = None) -> dict:
    """Chạy v3 từng bước trên một ảnh dataset (mặc định ví dụ đầu tiên) để minh họa."""
    from detect.v3.explain import explain

    ds, id = (ds, id) if ds and id else STEP_EXAMPLES[0][:2]
    try:
        label = results.labels(ds)["by_id"][id]
    except KeyError:
        raise HTTPException(404, "Không có ảnh này trong dataset") from None
    bgr = cv2.imread(str(DATASET_DIR / ds / label["image"]), cv2.IMREAD_COLOR)
    if bgr is None:
        raise HTTPException(404, "Không đọc được ảnh")
    data = explain(bgr)
    data["source"] = {"dataset": ds, "id": id, "gt": label.get("corners") if label.get("found") else None}
    data["examples"] = [{"dataset": d, "id": i, "title": t} for d, i, t in STEP_EXAMPLES]
    mirror_report = CORE_DIR / "reports" / "v3-mirror-check.json"
    if mirror_report.is_file():
        data["mirrorCheck"] = {k: v for k, v in json.loads(mirror_report.read_text(encoding="utf-8")).items()
                               if k != "mismatches"}
    return data


@router.get("")
def algorithms() -> dict:
    versions = {}
    for version in ("v2", "v3"):
        try:
            detector = detect.get_detector(version)
        except KeyError:
            versions[version] = {"available": False}
            continue
        versions[version] = {"available": True, "name": detector.name,
                             "params": {name: getattr(detector.params, name)
                                        for name, _ in detector.params._fields_}}
    report_path = CORE_DIR / "reports" / "v3-validation.json"
    validation = None
    examples = []
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        validation = {k: v for k, v in report.items() if k != "datasets"}
        validation["datasets"] = {ds: {v: result["summary"] for v, result in versions.items()}
                                  for ds, versions in report["datasets"].items()}
        expected = report.get("nativeSources", {})
        actual = {}
        for v in ("v2", "v3"):
            folder = "docdetect" if v == "v2" else "docdetect_v3"
            actual[v] = {p.name: hashlib.sha256(p.read_text(encoding="utf-8").encode()).hexdigest()
                         for p in sorted((CORE_DIR / "native" / folder / "src").glob("*"))}
        validation["matchesSources"] = expected == actual
        for ds, runs in report["datasets"].items():
            if "v2" not in runs or "v3" not in runs:
                continue
            before = {row["id"]: row for row in runs["v2"]["items"]}
            pairs = [(before[row["id"]], row) for row in runs["v3"]["items"]
                     if row["gtFound"] and row["id"] in before]
            if not pairs:
                continue
            pairs.sort(key=lambda pair: pair[1]["iou"] - pair[0]["iou"])
            try:
                labels = results.labels(ds)["by_id"]
            except KeyError:
                continue
            for kind, (old, new) in (("gain", pairs[-1]), ("regression", pairs[0])):
                label = labels.get(new["id"])
                if not label:
                    continue
                examples.append({"dataset": ds, "id": new["id"], "kind": kind,
                                 "width": label["width"], "height": label["height"], "gt": label["corners"],
                                 "v2": old["pred"], "v3": new["pred"], "iou2": old["iou"], "iou3": new["iou"]})
    return {"versions": versions, "validation": validation, "examples": examples}
