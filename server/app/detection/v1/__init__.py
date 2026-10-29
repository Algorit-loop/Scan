"""Detect v1 — cổ điển, dựa trên đường thẳng (tài liệu nghiên cứu, mục 4.1–4.2 và 4.3 dự phòng).

Các bước:
1. Thu nhỏ ảnh; làm "đóng hình thái" để xóa chữ/hình bên trong trang.
2. LSD tìm đoạn thẳng -> gộp đoạn thẳng hàng thành đường dài (bỏ chi tiết ngắn như vòng gáy xoắn).
3. Sinh tứ giác từ giao điểm các đường -> góc suy từ hai mép kéo dài (chịu được góc gấp, che một phần).
4. Thêm ứng viên từ phân vùng nền/giấy (màu, độ sáng; GrabCut khi cần) để xử lý ca tương phản thấp.
5. Chấm điểm từng ứng viên (độ phủ cạnh × tương phản trong/ngoài), lấy điểm cao nhất.
"""

from __future__ import annotations

import time

import cv2
import numpy as np

from ..base import DetectionResult, found_result, not_found
from . import params as P
from .lines import Line, detect_segments, merge_segments
from .quads import Candidate, from_grabcut, from_lines, from_regions
from .scoring import ScoreContext, score_quad


class V1Detector:
    version = "v1"
    name = "Cổ điển: đường thẳng + chấm điểm tứ giác"
    description = (
        "LSD tìm đường thẳng dài, dựng tứ giác từ giao điểm, chấm điểm theo độ phủ cạnh và tương phản trong/ngoài. "
        "Có thêm ứng viên từ phân vùng màu/độ sáng và GrabCut."
    )

    def detect(self, img: np.ndarray) -> DetectionResult:
        t0 = time.perf_counter()
        h0, w0 = img.shape[:2]
        scale = min(1.0, P.WORK_SIDE / max(h0, w0))
        small = (
            cv2.resize(img, (round(w0 * scale), round(h0 * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
        )
        h, w = small.shape[:2]
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        debug: dict = {"workSize": [w, h], "sharpness": round(sharpness, 1)}
        if float(gray.std()) < P.LOW_CONTRAST_STD:
            return not_found("lowContrast", debug=debug)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (P.CLOSE_KERNEL, P.CLOSE_KERNEL))
        smooth = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel, iterations=P.CLOSE_ITERATIONS)
        lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
        t1 = time.perf_counter()

        lines: list[Line] = merge_segments(detect_segments(smooth), (w, h))
        t2 = time.perf_counter()

        ctx = ScoreContext.build(smooth, lab)
        cands: list[Candidate] = from_lines(lines, (w, h)) + from_regions(small, lab, gray)
        best = self._best(cands, ctx)
        if best is None or best.score < P.GRABCUT_TRIGGER:
            extra = from_grabcut(small)
            gb = self._best(extra, ctx)
            if gb is not None and (best is None or gb.score > best.score):
                best = gb
            cands += extra
        t3 = time.perf_counter()

        debug["lines"] = [
            [round(float(p[0]) / w, 4), round(float(p[1]) / h, 4), round(float(q[0]) / w, 4), round(float(q[1]) / h, 4)]
            for p, q in (ln.endpoints() for ln in lines)
        ]
        debug["candidates"] = len(cands)
        debug["timingsMs"] = {
            "prep": round((t1 - t0) * 1000, 1),
            "lines": round((t2 - t1) * 1000, 1),
            "quads": round((t3 - t2) * 1000, 1),
            "total": round((t3 - t0) * 1000, 1),
        }

        if best is None or best.score < P.MIN_SCORE:
            if best is not None:
                debug["bestScore"] = round(best.score, 3)
            return not_found("none", debug=debug)

        debug["score"] = round(best.score, 3)
        debug["scoreDetail"] = best.detail
        # Điểm MIN_SCORE -> độ tin cậy thấp; từ 0.8 trở lên -> 1.
        confidence = min(1.0, best.score / 0.8)
        return found_result(best.quad, (w, h), confidence, best.source, debug=debug)

    @staticmethod
    def _best(cands: list[Candidate], ctx: ScoreContext) -> Candidate | None:
        best = None
        for c in cands:
            c.score, c.detail = score_quad(c.quad, ctx)
            if best is None or c.score > best.score:
                best = c
        return best


DETECTOR = V1Detector()
