"""Web visualize của Core: xem dataset, kết quả đánh giá, so sánh phiên bản detect, thử ảnh.

Chạy (từ Core/):  .\\run.ps1   rồi mở http://localhost:8000/

Mỗi trang có URL riêng (mở tab mới / tải lại vẫn giữ nguyên trạng thái):
    /                               tổng quan: bảng chỉ số mọi phiên bản × bộ dữ liệu
    /d/<dataset>?run=..&vs=..       một bộ dữ liệu: chỉ số, theo nhóm, lưới ảnh có lọc
    /d/<dataset>/i/<id>?run=..      một ảnh: đáp án + dự đoán của mọi phiên bản, detect lại
    /try, /try/<id>                 thử ảnh bất kỳ
    /eval                           chạy đánh giá
    /algorithms                     thuật toán v3 từng bước, có ảnh minh họa
    /video                          luồng xử lý video của app (camera -> detect -> theo dõi -> chụp)
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .routes import algorithms, datasets, evaluate, playground, video

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

STATIC = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Scan Core")
app.include_router(datasets.router)
app.include_router(playground.router)
app.include_router(evaluate.router)
app.include_router(algorithms.router)
app.include_router(video.router)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def no_stale_static(request: Request, call_next):
    """File tĩnh: trình duyệt luôn hỏi lại server (ETag -> 304 nếu không đổi), không dùng bản cache cũ."""
    response = await call_next(request)
    if request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def _build_id() -> str:
    """Đổi mỗi khi sửa file tĩnh -> URL của app.js/app.css đổi theo, cache cũ không bao giờ được dùng."""
    return str(int(max(f.stat().st_mtime for f in STATIC.rglob("*") if f.is_file())))


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str) -> HTMLResponse:
    """Mọi đường dẫn không phải /api, /static trả về trang web; trình duyệt tự định tuyến theo URL."""
    if path.startswith("api/"):
        raise HTTPException(404, "Không có API này")
    html = (STATIC / "index.html").read_text(encoding="utf-8").replace("__BUILD__", _build_id())
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})
