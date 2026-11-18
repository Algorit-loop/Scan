"""Detect v2 — cùng thuật toán v1 nhưng viết bằng C++ (native/docdetect), gọi qua ctypes.

Khác v1: bỏ GrabCut (chiếm ~50% thời gian v1), làm việc ở ảnh cạnh dài 256 px, mọi vòng lặp chạy trong C++.
Thư viện C++ dùng chung cho mobile sau này. Build trước khi dùng: .
ativedocdetectbuild.ps1 (chạy từ Core/).
"""

from __future__ import annotations

import ctypes as C
import os
from pathlib import Path

import numpy as np

from ..base import DetectionResult, found_result, not_found

DLL_NAME = "docdetect.dll" if os.name == "nt" else "docdetect.so"
DLL_PATH = Path(os.environ.get("DOCDETECT_LIB", Path(__file__).resolve().parents[2] / "native" / "docdetect" / "build" / DLL_NAME))
METHODS = ["lines", "color", "bright", "dark"]
MAX_LINES = 32


class Params(C.Structure):
    _fields_ = [(n, t) for n, t in [
        ("work_side", C.c_int), ("low_contrast_std", C.c_float), ("close_kernel", C.c_int), ("close_iterations", C.c_int),
        ("min_segment", C.c_float), ("merge_angle", C.c_float), ("merge_dist", C.c_float), ("min_line_cover", C.c_float),
        ("max_lines", C.c_int), ("parallel_tol", C.c_float), ("min_corner_angle_sin", C.c_float),
        ("min_side_separation", C.c_float), ("min_area_ratio", C.c_float), ("corner_margin", C.c_float),
        ("prescore_keep", C.c_int), ("use_regions", C.c_int), ("grad_sigma", C.c_float), ("lab_sigma", C.c_float),
        ("sample_step", C.c_float), ("side_trim", C.c_float), ("edge_window", C.c_int), ("contrast_offset", C.c_float),
        ("contrast_full", C.c_float), ("border_credit", C.c_float), ("border_touch_px", C.c_float),
        ("min_score", C.c_float), ("confidence_full", C.c_float),
        ("roi_x", C.c_int), ("roi_y", C.c_int), ("roi_w", C.c_int), ("roi_h", C.c_int),
    ]]


class Point(C.Structure):
    _fields_ = [("x", C.c_float), ("y", C.c_float)]


class Result(C.Structure):
    _fields_ = [
        ("found", C.c_int), ("reason", C.c_int), ("method", C.c_int), ("corners", Point * 4),
        ("confidence", C.c_float), ("score", C.c_float), ("coverage", C.c_float * 4), ("contrast", C.c_float * 4),
        ("consistency", C.c_float), ("area", C.c_float), ("sharpness", C.c_float), ("candidates", C.c_int),
        ("n_lines", C.c_int), ("lines", (C.c_float * 4) * MAX_LINES), ("work_width", C.c_int), ("work_height", C.c_int),
        ("ms_prep", C.c_float), ("ms_lines", C.c_float), ("ms_quads", C.c_float), ("ms_total", C.c_float),
    ]


def load_library() -> C.CDLL:
    lib = C.CDLL(str(DLL_PATH))
    lib.dd_version.restype = C.c_char_p
    lib.dd_default_params.argtypes = [C.POINTER(Params)]
    lib.dd_detect.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_int, C.POINTER(Params), C.POINTER(Result)]
    lib.dd_detect.restype = C.c_int
    lib.dd_set_num_threads.argtypes = [C.c_int]
    return lib


class V2Detector:
    supports_roi = True  # vùng roi xử lý trong C++ (xem detection.detect_in_roi)
    version = "v2"
    name = "C++: đường thẳng + chấm điểm (nhanh)"
    description = "Thuật toán v1 viết lại bằng C++ (native/docdetect), bỏ GrabCut, ảnh làm việc 256 px. Dùng chung cho mobile."

    def __init__(self) -> None:
        self.lib = load_library()
        self.lib.dd_set_num_threads(int(os.environ.get("DOCDETECT_THREADS", "1")))
        self.params = Params()
        self.lib.dd_default_params(C.byref(self.params))

    def detect(self, img: np.ndarray, roi: tuple[int, int, int, int] | None = None) -> DetectionResult:
        """roi=(x, y, w, h): chỉ xét vùng này; tọa độ trả về chuẩn hóa theo roi (như các phiên bản khác)."""
        img = np.ascontiguousarray(img)
        H, W = img.shape[:2]
        fmt = 1 if img.ndim == 2 else 3
        rx, ry, w, h = roi or (0, 0, W, H)
        p = Params.from_buffer_copy(self.params)
        p.roi_x, p.roi_y, p.roi_w, p.roi_h = rx, ry, w, h
        r = Result()
        code = self.lib.dd_detect(img.ctypes.data, W, H, int(img.strides[0]), fmt, C.byref(p), C.byref(r))
        if code != 0:
            raise ValueError(f"docdetect lỗi {code}")
        debug = {
            "workSize": [r.work_width, r.work_height],
            "sharpness": round(r.sharpness, 1),
            "lines": [[round((r.lines[i][k] * (W if k % 2 == 0 else H) - (rx if k % 2 == 0 else ry)) / (w if k % 2 == 0 else h), 4)
                       for k in range(4)] for i in range(r.n_lines)],
            "candidates": r.candidates,
            "timingsMs": {"prep": round(r.ms_prep, 2), "lines": round(r.ms_lines, 2), "quads": round(r.ms_quads, 2), "total": round(r.ms_total, 2)},
        }
        if not r.found:
            if r.reason == 2:
                return not_found("lowContrast", debug=debug)
            if r.candidates:
                debug["bestScore"] = round(r.score, 3)
            return not_found("none", debug=debug)
        debug["score"] = round(r.score, 3)
        debug["scoreDetail"] = {
            "coverage": [round(v, 3) for v in r.coverage], "contrast": [round(v, 3) for v in r.contrast],
            "consistency": round(r.consistency, 3), "area": round(r.area, 3),
        }
        corners = np.array([[c.x * W - rx, c.y * H - ry] for c in r.corners], np.float32)  # pixel trong roi
        return found_result(corners, (w, h), r.confidence, METHODS[r.method], debug=debug)


def available() -> bool:
    return DLL_PATH.is_file()


DETECTOR = V2Detector() if available() else None
