"""Trang "Thử ảnh": upload ảnh bất kỳ, chạy detect, lưu vào uploads/ để xem lại."""

from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

import detect
from detect import imaging

from .. import storage

router = APIRouter(prefix="/api/try")
MAX_UPLOAD_BYTES = 40 * 1024 * 1024


def _run(raw: bytes, filename: str, version: str | None, size: int) -> dict:
    detector = detect.get_detector(version)
    t0 = time.perf_counter()
    img = imaging.decode_bytes(raw)
    t1 = time.perf_counter()
    result = imaging.detect_letterboxed(detector, img, size)  # cùng pipeline với tools/evaluate.py
    t2 = time.perf_counter()
    timings = {"decode": round((t1 - t0) * 1000, 1), "detect": round((t2 - t1) * 1000, 1)}
    return storage.save(raw=raw, img=img, filename=filename, version=detector.version, size=size,
                        result=result, timings_ms=timings)


@router.post("")
async def create(request: Request, version: str | None = None, size: int = imaging.LETTERBOX_SIZE,
                 filename: str = "image") -> dict:
    """Body = byte thô của file ảnh."""
    if int(request.headers.get("content-length") or 0) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Ảnh quá lớn (tối đa {MAX_UPLOAD_BYTES // 2**20} MB)")
    raw = await request.body()
    if not raw:
        raise HTTPException(400, "Không có dữ liệu ảnh")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Ảnh quá lớn (tối đa {MAX_UPLOAD_BYTES // 2**20} MB)")
    if not 64 <= size <= 2048:
        raise HTTPException(400, "Cỡ letterbox phải trong 64..2048")
    try:
        return await run_in_threadpool(_run, raw, filename[:200], version, size)
    except KeyError as e:
        raise HTTPException(400, str(e.args[0])) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.get("")
def list_all() -> list[dict]:
    return storage.list_all()


@router.get("/{detection_id}")
def get(detection_id: str) -> dict:
    try:
        return storage.get(detection_id)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy") from None


@router.get("/{detection_id}/files/{kind}")
def get_file(detection_id: str, kind: str) -> FileResponse:
    try:
        return FileResponse(storage.file_path(detection_id, kind))
    except KeyError:
        raise HTTPException(404, "Không tìm thấy file") from None


@router.delete("/{detection_id}")
def delete(detection_id: str) -> dict:
    try:
        storage.delete(detection_id)
    except KeyError:
        raise HTTPException(404, "Không tìm thấy") from None
    return {"ok": True}
