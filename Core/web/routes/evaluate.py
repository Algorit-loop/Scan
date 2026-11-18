"""Chạy tools/evaluate.py từ trang web (một lượt mỗi lần) và theo dõi tiến độ."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import detect
from paths import dataset_names

from .. import eval_runner

router = APIRouter(prefix="/api/eval")


class RunRequest(BaseModel):
    version: str = "v1"
    datasets: list[str]
    limit: int | None = None
    size: int = 256


@router.post("/run")
def run(req: RunRequest) -> dict:
    if req.version not in {d["version"] for d in detect.list_detectors()}:
        raise HTTPException(400, f"Không có phiên bản {req.version}")
    bad = [d for d in req.datasets if d not in dataset_names()]
    if not req.datasets or bad:
        raise HTTPException(400, f"Bộ dữ liệu không hợp lệ: {', '.join(bad) or '(trống)'}")
    if not 64 <= req.size <= 2048:
        raise HTTPException(400, f"Cỡ letterbox không hợp lệ: {req.size}")
    try:
        return eval_runner.start(req.version, req.datasets, req.limit, req.size)
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/status")
def status() -> dict:
    return eval_runner.status()


@router.post("/cancel")
def cancel() -> dict:
    eval_runner.cancel()
    return eval_runner.status()
