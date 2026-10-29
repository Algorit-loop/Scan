"""Cấu hình server."""

from __future__ import annotations

import os
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent

# Nơi lưu ảnh upload và kết quả detect của trang web kiểm tra. Đổi bằng biến môi trường SCAN_DATA_DIR.
DATA_DIR = Path(os.environ.get("SCAN_DATA_DIR", SERVER_DIR / "data"))

WEB_DIR = Path(__file__).resolve().parent / "web"

# Giới hạn dung lượng ảnh upload.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
