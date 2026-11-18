"""Đọc dataset/<tên>/labels.json và results/<run>/<tên>.json, ghép theo id ảnh để web lọc/so sánh.

File được cache trong bộ nhớ theo mtime: chạy đánh giá xong là trang web thấy ngay kết quả mới.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

import numpy as np

from detect.metrics import SUCCESS_IOU, summarize
from paths import DATASET_DIR, RESULT_DIR, dataset_names

_lock = threading.Lock()
_cache: dict[Path, tuple[float, Any]] = {}

# Chênh IoU tối thiểu để coi là "tốt hơn"/"kém hơn" khi so 2 phiên bản.
DELTA_EPS = 0.02

FILTERS = ("all", "fail", "miss", "ok", "neg", "fp", "better", "worse")


def _load(path: Path, build=None) -> Any:
    mtime = path.stat().st_mtime
    with _lock:
        hit = _cache.get(path)
        if hit and hit[0] == mtime:
            return hit[1]
    data = json.loads(path.read_text(encoding="utf-8"))
    if build:
        data = build(data)
    with _lock:
        _cache[path] = (mtime, data)
    return data


def _check_dataset(ds: str) -> Path:
    if ds not in dataset_names():
        raise KeyError(ds)
    return DATASET_DIR / ds


# ---------------------------------------------------------------- dataset
def labels(ds: str) -> dict:
    """{'order': [id...], 'by_id': {id: rec}, 'groups': [...]}"""
    def build(recs: list[dict]) -> dict:
        return {
            "order": [r["id"] for r in recs],
            "by_id": {r["id"]: r for r in recs},
            "groups": sorted({r["group"] for r in recs if r.get("group")}),
        }
    return _load(_check_dataset(ds) / "labels.json", build)


def dataset_info(ds: str) -> dict:
    lb = labels(ds)
    recs = lb["by_id"].values()
    readme = DATASET_DIR / ds / "README.md"
    return {
        "name": ds,
        "images": len(lb["order"]),
        "positives": sum(1 for r in recs if r["found"]),
        "groups": lb["groups"],
        "readme": readme.read_text(encoding="utf-8") if readme.is_file() else "",
    }


# ---------------------------------------------------------------- runs
def _run_path(ds: str, run: str) -> Path:
    _check_dataset(ds)
    if "/" in run or "\\" in run or run.startswith("."):
        raise KeyError(run)
    p = RESULT_DIR / run / f"{ds}.json"
    if not p.is_file():
        raise KeyError(run)
    return p


def _build_run(data: dict) -> dict:
    data["by_id"] = {it["id"]: it for it in data["items"]}
    return data


def run_data(ds: str, run: str) -> dict:
    return _load(_run_path(ds, run), _build_run)


def run_summary(data: dict, run: str) -> dict:
    return {
        "run": run, "version": data.get("version"), "detector": data.get("detector"), "dataset": data.get("dataset"),
        "createdAt": data.get("createdAt"), "size": (data.get("normalize") or {}).get("size"),
        "summary": data.get("summary"),
    }


def runs(ds: str) -> list[dict]:
    """Mọi lượt đánh giá đã có cho bộ dữ liệu, sắp theo tên run (v1@256, v2@256, v2@640...)."""
    _check_dataset(ds)
    out = []
    for f in sorted(RESULT_DIR.glob(f"*/{ds}.json"), key=lambda f: _run_sort_key(f.parent.name)):
        try:
            out.append(run_summary(run_data(ds, f.parent.name), f.parent.name))
        except (OSError, ValueError, KeyError):
            continue  # file đang ghi dở hoặc hỏng
    return out


def _run_sort_key(run: str) -> tuple:
    v, _, size = run.partition("@")
    return (v, int(size) if size.isdigit() else 0)


# ---------------------------------------------------------------- items
def _pred(it: dict | None) -> dict | None:
    if it is None:
        return None
    return {"found": it["found"], "pred": it["pred"], "iou": it["iou"], "cornerErr": it["cornerErr"],
            "confidence": it["confidence"], "method": it["method"], "ms": it["ms"]}


def _rows(ds: str, run: str | None, vs: str | None) -> list[dict]:
    lb = labels(ds)
    a = run_data(ds, run)["by_id"] if run else None
    b = run_data(ds, vs)["by_id"] if vs else None
    ids = [i for i in lb["order"] if i in a] if a is not None else lb["order"]
    if b is not None:  # so sánh: chỉ các ảnh có trong cả 2 lượt (khớp với stats())
        ids = [i for i in ids if i in b]
    rows = []
    for i in ids:
        rec = lb["by_id"][i]
        ra, rb = _pred(a.get(i)) if a is not None else None, _pred(b.get(i)) if b is not None else None
        delta = None
        if ra and rb and ra["iou"] is not None and rb["iou"] is not None:
            delta = round(ra["iou"] - rb["iou"], 4)
        rows.append({"id": i, "group": rec.get("group"), "w": rec["width"], "h": rec["height"],
                     "gtFound": rec["found"], "gt": rec["corners"], "a": ra, "b": rb, "delta": delta})
    return rows


def _match(r: dict, f: str) -> bool:
    a = r["a"]
    if f == "all":
        return True
    if f == "neg":
        return not r["gtFound"]
    if a is None:
        return False
    if f == "fail":
        return r["gtFound"] and a["iou"] < SUCCESS_IOU
    if f == "miss":
        return r["gtFound"] and not a["found"]
    if f == "ok":
        return r["gtFound"] and a["iou"] >= SUCCESS_IOU
    if f == "fp":
        return not r["gtFound"] and a["found"]
    if f == "better":
        return r["delta"] is not None and r["delta"] > DELTA_EPS
    if f == "worse":
        return r["delta"] is not None and r["delta"] < -DELTA_EPS
    return True


SORTS = {
    "id": (lambda r: r["id"], False),
    "iou": (lambda r: (r["a"] or {}).get("iou"), False),
    "-iou": (lambda r: (r["a"] or {}).get("iou"), True),
    "delta": (lambda r: r["delta"], False),
    "-delta": (lambda r: r["delta"], True),
    "-ms": (lambda r: (r["a"] or {}).get("ms"), True),
    "conf": (lambda r: (r["a"] or {}).get("confidence"), False),
}


def _sorted(rows: list[dict], sort: str) -> list[dict]:
    key, rev = SORTS.get(sort, SORTS["id"])
    have = [r for r in rows if key(r) is not None]
    missing = [r for r in rows if key(r) is None]  # giá trị trống luôn nằm cuối
    return sorted(have, key=key, reverse=rev) + missing


def query(ds: str, run: str | None, vs: str | None, flt: str = "all", group: str | None = None,
          sort: str = "id", q: str = "") -> tuple[list[dict], dict]:
    """Trả (các dòng đã lọc + sắp xếp, số đếm theo từng bộ lọc trong nhóm đang chọn)."""
    rows = _rows(ds, run, vs)
    if group:
        rows = [r for r in rows if r["group"] == group]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r["id"].lower()]
    counts = {f: sum(1 for r in rows if _match(r, f)) for f in FILTERS}
    rows = _sorted([r for r in rows if _match(r, flt)], sort)
    return rows, counts


def item(ds: str, item_id: str) -> dict:
    """Đáp án + dự đoán của mọi lượt đánh giá có ảnh này."""
    lb = labels(ds)
    rec = lb["by_id"].get(item_id)
    if rec is None:
        raise KeyError(item_id)
    preds = {}
    for r in runs(ds):
        it = run_data(ds, r["run"])["by_id"].get(item_id)
        if it is not None:
            preds[r["run"]] = _pred(it)
    return {"label": rec, "runs": preds}


# ---------------------------------------------------------------- stats
def stats(ds: str, run: str, vs: str | None) -> dict:
    """Chỉ số của run (và vs) — khi so sánh, tính trên tập ảnh CHUNG của 2 run để công bằng."""
    a = run_data(ds, run)
    b = run_data(ds, vs) if vs else None
    if b is not None:
        common = [i for i in a["by_id"] if i in b["by_id"]]
        ia = [a["by_id"][i] for i in common]
        ib = [b["by_id"][i] for i in common]
    else:
        ia, ib = a["items"], None
    groups = sorted({it.get("group") for it in ia if it.get("group")})

    def per_group(items: list[dict]) -> dict:
        out = {}
        for g in groups:
            sub = [it for it in items if it.get("group") == g]
            pos = [it["iou"] for it in sub if it["gtFound"]]
            out[g] = {"images": len(sub), "meanIoU": round(float(np.mean(pos)), 4) if pos else None,
                      "success": round(float(np.mean(np.array(pos) >= SUCCESS_IOU)), 4) if pos else None}
        return out

    ga = per_group(ia)
    gb = per_group(ib) if ib is not None else {}
    return {
        "run": run, "vs": vs, "images": len(ia), "partial": b is not None and len(ia) < len(a["items"]),
        "a": summarize(ia), "b": summarize(ib) if ib is not None else None,
        "groups": [{"group": g, "a": ga[g], "b": gb.get(g)} for g in groups],
        "successIoU": SUCCESS_IOU,
    }
