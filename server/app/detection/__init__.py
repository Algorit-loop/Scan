"""Các phiên bản detect tài liệu.

Mỗi phiên bản là một package con (v1, v2, ...) chứa một lớp `Detector` và tự đăng ký ở đây.
App/web chọn phiên bản theo tên; thêm phiên bản mới = thêm package + một dòng `register(...)`.
"""

from __future__ import annotations

from .base import Detector, DetectionResult

DEFAULT_VERSION = "v1"

_registry: dict[str, Detector] = {}


def register(detector: Detector) -> None:
    _registry[detector.version] = detector


def get_detector(version: str | None = None) -> Detector:
    version = version or DEFAULT_VERSION
    try:
        return _registry[version]
    except KeyError:
        raise KeyError(f"Không có phiên bản detect '{version}'. Hiện có: {', '.join(_registry)}") from None


def list_detectors() -> list[dict]:
    return [
        {"version": d.version, "name": d.name, "description": d.description, "default": d.version == DEFAULT_VERSION}
        for d in _registry.values()
    ]


from .v1 import DETECTOR as _v1  # noqa: E402

register(_v1)

__all__ = ["Detector", "DetectionResult", "DEFAULT_VERSION", "get_detector", "list_detectors", "register"]
