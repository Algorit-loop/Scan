"""API xem bộ dữ liệu và kết quả đánh giá: danh sách ảnh có lọc/sắp xếp, chỉ số, ảnh, detect lại một ảnh."""

from __future__ import annotations

import time

import cv2
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

import detect
from detect import imaging
from paths import CACHE_DIR, DATASET_DIR, dataset_names

from .. import results

router = APIRouter(prefix="/api")
THUMB_SIDE = 360
PAGE_MAX = 200


def _guard(fn, *args, **kw):
    try:
        return fn(*args, **kw)
    except KeyError as e:
        raise HTTPException(404, f"Không tìm thấy: {e.args[0] if e.args else ''}") from None


@router.get("/meta")
def meta() -> dict:
    """Mọi thứ trang web cần lúc mở: phiên bản detect, các bộ dữ liệu và các lượt đánh giá đã có."""
    return {
        "detectors": detect.list_detectors(),
        "letterbox": imaging.LETTERBOX_SIZE,
        "datasets": [
            {**{k: v for k, v in results.dataset_info(ds).items() if k != "readme"}, "runs": results.runs(ds)}
            for ds in dataset_names()
        ],
    }


@router.get("/datasets/{ds}")
def dataset(ds: str) -> dict:
    return {**_guard(results.dataset_info, ds), "runs": _guard(results.runs, ds)}


@router.get("/datasets/{ds}/stats")
def stats(ds: str, run: str, vs: str | None = None) -> dict:
    return _guard(results.stats, ds, run, vs or None)


@router.get("/datasets/{ds}/items")
def items(ds: str, run: str | None = None, vs: str | None = None, filter: str = "all", group: str | None = None,
          sort: str = "id", q: str = "", offset: int = 0, limit: int = 60) -> dict:
    rows, counts = _guard(results.query, ds, run or None, vs or None, filter, group or None, sort, q.strip())
    limit = max(1, min(limit, PAGE_MAX))
    return {"total": len(rows), "counts": counts, "offset": offset, "items": rows[offset:offset + limit]}


@router.get("/datasets/{ds}/items/{item_id}")
def item(ds: str, item_id: str, run: str | None = None, vs: str | None = None, filter: str = "all",
         group: str | None = None, sort: str = "id", q: str = "") -> dict:
    """Chi tiết một ảnh + vị trí của nó trong danh sách đang lọc (để bấm ảnh trước/sau)."""
    data = _guard(results.item, ds, item_id)
    rows, _ = _guard(results.query, ds, run or None, vs or None, filter, group or None, sort, q.strip())
    ids = [r["id"] for r in rows]
    pos = ids.index(item_id) if item_id in ids else -1
    data["nav"] = {
        "index": pos, "total": len(ids),
        "prev": ids[pos - 1] if pos > 0 else None,
        "next": ids[pos + 1] if 0 <= pos < len(ids) - 1 else None,
    }
    return data


def _image_path(ds: str, item_id: str):
    rec = _guard(results.labels, ds)["by_id"].get(item_id)
    if rec is None:
        raise HTTPException(404, "Không có ảnh")
    return rec, DATASET_DIR / ds / rec["image"]


@router.get("/datasets/{ds}/images/{item_id}")
def image(ds: str, item_id: str, thumb: bool = False) -> FileResponse:
    _, src = _image_path(ds, item_id)
    if not src.is_file():
        raise HTTPException(404, "Không có ảnh")
    headers = {"Cache-Control": "max-age=86400"}
    if not thumb:
        return FileResponse(src, headers=headers)
    dst = CACHE_DIR / "thumbs" / ds / f"{src.stem}.jpg"
    if not dst.is_file() or dst.stat().st_mtime < src.stat().st_mtime:
        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(404, "Ảnh hỏng")
        h, w = img.shape[:2]
        s = THUMB_SIDE / max(h, w)
        if s < 1:
            img = cv2.resize(img, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA)
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(imaging.encode_jpeg(img, 82))
    return FileResponse(dst, headers=headers)


@router.post("/datasets/{ds}/items/{item_id}/detect")
async def detect_one(ds: str, item_id: str, version: str | None = None, size: int = imaging.LETTERBOX_SIZE) -> dict:
    """Detect lại một ảnh với phiên bản hiện tại của code (kèm debug: đường thẳng tìm được...)."""
    if not 64 <= size <= 2048:
        raise HTTPException(400, "Cỡ letterbox phải trong 64..2048")
    _, src = _image_path(ds, item_id)

    def run() -> dict:
        det = detect.get_detector(version)
        img = cv2.imread(str(src), cv2.IMREAD_COLOR)
        t0 = time.perf_counter()
        res = imaging.detect_letterboxed(det, img, size)
        return {"version": det.version, "size": size, "ms": round((time.perf_counter() - t0) * 1000, 1), "result": res}

    try:
        return await run_in_threadpool(run)
    except KeyError as e:
        raise HTTPException(400, str(e.args[0])) from e
