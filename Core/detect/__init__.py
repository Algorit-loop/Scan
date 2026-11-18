"""Các phiên bản detect tài liệu.

Mỗi phiên bản là một package con (v1, v2, ...) chứa một lớp `Detector` và tự đăng ký ở đây.
Web/script đánh giá chọn phiên bản theo tên; thêm phiên bản mới = thêm package + một dòng `register(...)`.
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


def detect_in_roi(detector: Detector, img, roi: tuple[int, int, int, int] | None) -> DetectionResult:
    """Detect chỉ trong vùng roi=(x, y, w, h) của img (vd. bỏ dải viền letterbox).
    Tọa độ trong kết quả chuẩn hóa theo roi. Phiên bản có `supports_roi` tự xử lý (vd. v2 trong C++);
    phiên bản khác nhận ảnh đã cắt (chỉ là view numpy, không copy)."""
    if roi is None:
        return detector.detect(img)
    if getattr(detector, "supports_roi", False):
        return detector.detect(img, roi=roi)
    x, y, w, h = roi
    return detector.detect(img[y:y + h, x:x + w])


def list_detectors() -> list[dict]:
    return [
        {"version": d.version, "name": d.name, "description": d.description, "default": d.version == DEFAULT_VERSION}
        for d in _registry.values()
    ]


from .v1 import DETECTOR as _v1  # noqa: E402

register(_v1)

from .v2 import DETECTOR as _v2  # noqa: E402  (chỉ có khi đã build native/docdetect)

if _v2 is not None:
    register(_v2)

__all__ = ["Detector", "DetectionResult", "DEFAULT_VERSION", "detect_in_roi", "get_detector", "list_detectors", "register"]

from .v3 import DETECTOR as _v3  # noqa: E402

if _v3 is not None:
    register(_v3)
