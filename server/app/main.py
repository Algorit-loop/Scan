"""Server xử lý ảnh cho app Scan Trợ Giúp.

- Trang web kiểm tra detect: GET /            (routes/web.py)
- API cho app điện thoại:    /ws, /warp, /health (routes/mobile.py)
- Các phiên bản detect:      app/detection/<vN>/
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import config
from .routes import mobile, web

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

app = FastAPI(title="Scan Trợ Giúp server")
app.include_router(mobile.router)
app.include_router(web.router)
app.mount("/static", StaticFiles(directory=config.WEB_DIR / "static"), name="static")
