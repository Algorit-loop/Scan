"""Đường dẫn dùng chung cho mọi phần của Core (detect, tools, web).

Core/
    detect/      các phiên bản detect (v1 Python, v2 gọi C++)
    native/      thư viện C++ docdetect (v2, dùng chung cho mobile)
    dataset/     bộ dữ liệu đã chuẩn hóa (<tên>/images + labels.json); dữ liệu gốc ở dataset/_raw
    results/     kết quả đánh giá: results/<version>@<size>/<dataset>.json
    tools/       script: chuẩn hóa dataset, đánh giá, benchmark
    web/         trang web visualize (FastAPI + static)
    uploads/     ảnh thử trên trang web
"""

from __future__ import annotations

import os
from pathlib import Path

CORE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = CORE_DIR.parent

DATASET_DIR = Path(os.environ.get("SCAN_DATASET_DIR", CORE_DIR / "dataset"))
RAW_DIR = DATASET_DIR / "_raw"
RESULT_DIR = Path(os.environ.get("SCAN_RESULT_DIR", CORE_DIR / "results"))
UPLOAD_DIR = Path(os.environ.get("SCAN_UPLOAD_DIR", CORE_DIR / "uploads"))
CACHE_DIR = CORE_DIR / ".cache"  # ảnh thu nhỏ cho web (xóa thoải mái)
NATIVE_DIR = CORE_DIR / "native"


def dataset_names() -> list[str]:
    """Các bộ dữ liệu đã chuẩn hóa (có labels.json). Bỏ qua thư mục bắt đầu bằng _ hoặc . (vd. _raw)."""
    return sorted(
        f.parent.name for f in DATASET_DIR.glob("*/labels.json") if not f.parent.name.startswith(("_", "."))
    )
