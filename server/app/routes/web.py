"""Trang web kiểm tra detect: upload ảnh, chạy detect, lưu và xem lại kết quả."""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from .. import config, detection, imaging, storage

router = APIRouter()


@router.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(config.WEB_DIR / "static" / "index.html")


@router.get("/api/detectors")
def detectors() -> list[dict]:
    return detection.list_detectors()


def _run(raw: bytes, filename: str, version: str | None) -> dict:
    detector = detection.get_detector(version)
    t0 = time.perf_counter()
    img = imaging.decode_bytes(raw)
    t1 = time.perf_counter()
    result = detector.detect(img)
    t2 = time.perf_counter()
    timings = {"decode": round((t1 - t0) * 1000, 1), "detect": round((t2 - t1) * 1000, 1)}
    record = storage.save(raw=raw, img=img, filename=filename, version=detector.version, result=result, timings_ms=timings)
    return record


@router.post("/api/detections")
async def create_detection(request: Request, version: str | None = None, filename: str = "image") -> dict:
    """Body = byte thô của file ảnh (không dùng multipart để khỏi cần thư viện phụ)."""
    declared = int(request.headers.get("content-length") or 0)
    if declared > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Ảnh quá lớn (tối đa {config.MAX_UPLOAD_BYTES // 2**20} MB)")
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "Không có dữ liệu ảnh")
    if len(raw) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Ảnh quá lớn (tối đa {config.MAX_UPLOAD_BYTES // 2**20} MB)")
    try:
        return await run_in_threadpool(_run, raw, filename[:200], version)
    except KeyError as e:
        raise HTTPException(400, str(e.args[0])) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("/api/detections")
def list_detections() -> list[dict]:
    return storage.list_all()


@router.get("/api/detections/{detection_id}")
def get_detection(detection_id: str) -> dict:
    try:
        return storage.get(detection_id)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy kết quả") from None


@router.get("/api/detections/{detection_id}/files/{kind}")
def get_file(detection_id: str, kind: str) -> FileResponse:
    try:
        return FileResponse(storage.file_path(detection_id, kind))
    except KeyError:
        raise HTTPException(404, "Không tìm thấy file") from None


@router.delete("/api/detections/{detection_id}")
def delete_detection(detection_id: str) -> dict:
    try:
        storage.delete(detection_id)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy kết quả") from None
    return {"ok": True}
