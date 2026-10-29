"""Server xử lý ảnh cho app Scan Trợ Giúp.

- WS  /ws    : app gửi từng khung hình nhỏ, server trả kết quả nhận diện.
- POST /warp : app gửi ảnh độ phân giải cao + 4 góc, server trả ảnh đã nắn phẳng.
- GET /health: app dùng để kiểm tra server có chạy không.
"""

from __future__ import annotations

import json
import logging
import time

import cv2
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from . import detector

log = logging.getLogger("scan")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

app = FastAPI(title="Scan Trợ Giúp server")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "opencv": cv2.__version__}


def _process_frame(b64: str) -> tuple[dict, dict]:
    t0 = time.perf_counter()
    img = detector.decode_image(b64)
    t1 = time.perf_counter()
    result = detector.detect(img)
    t2 = time.perf_counter()
    timings = {"decode": (t1 - t0) * 1000, "detect": (t2 - t1) * 1000}
    return result, timings


@app.websocket("/ws")
async def ws_detect(ws: WebSocket) -> None:
    await ws.accept()
    client = f"{ws.client.host}:{ws.client.port}" if ws.client else "?"
    log.info("app kết nối: %s", client)
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            seq = msg.get("seq")
            try:
                result, timings = await run_in_threadpool(_process_frame, msg["image"])
            except Exception as e:  # ảnh hỏng, v.v. — báo lỗi nhưng giữ kết nối
                await ws.send_text(json.dumps({"seq": seq, "error": str(e)}))
                continue
            await ws.send_text(json.dumps({"seq": seq, "result": result, "timings": timings}))
            log.info(
                "khung %s: decode %.1f ms | detect %.1f ms | %s",
                seq,
                timings["decode"],
                timings["detect"],
                result.get("method", result.get("reason")),
            )
    except WebSocketDisconnect:
        log.info("app ngắt kết nối: %s", client)


class WarpRequest(BaseModel):
    image: str
    corners: list[dict]


@app.post("/warp")
async def warp(req: WarpRequest) -> dict:
    if len(req.corners) != 4:
        raise HTTPException(400, "Cần đúng 4 góc")

    def run() -> dict:
        t0 = time.perf_counter()
        img = detector.decode_image(req.image)
        out = detector.warp(img, req.corners)
        b64 = detector.encode_jpeg(out)
        log.info("warp %dx%d -> %dx%d trong %.0f ms", img.shape[1], img.shape[0], out.shape[1], out.shape[0], (time.perf_counter() - t0) * 1000)
        return {"image": b64, "width": out.shape[1], "height": out.shape[0]}

    try:
        return await run_in_threadpool(run)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
