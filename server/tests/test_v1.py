import json
from pathlib import Path

import cv2
import numpy as np
import pytest
import scenes as S

from app.detection import DEFAULT_VERSION, get_detector, list_detectors
from app.detection.metrics import quad_jaccard

BOX = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
TILT = [(0.25, 0.18), (0.85, 0.26), (0.76, 0.83), (0.16, 0.74)]
PERSP = [(0.3, 0.2), (0.72, 0.2), (0.9, 0.85), (0.1, 0.85)]
SMALL = [(0.4, 0.4), (0.62, 0.4), (0.62, 0.62), (0.4, 0.62)]
DIAMOND = [(0.5, 0.15), (0.85, 0.5), (0.5, 0.85), (0.15, 0.5)]
FILLS_FRAME = [(0.05, 0.05), (0.95, 0.05), (0.95, 0.9), (0.05, 0.9)]
TOUCHES_EDGES = [(0.0, 0.0), (1.0, 0.0), (1.0, 0.85), (0.0, 0.85)]  # tràn ra trái, phải, trên


def truth(corners):
    return [{"x": x, "y": y} for x, y in corners]


def detect(img):
    return get_detector("v1").detect(img)


def wood():
    return S.wood(np.random.default_rng(3))


# (tên ca, ảnh, đáp án, Jaccard tối thiểu). Ngưỡng 0.93 thấp hơn mức 0.95 của tài liệu một chút vì ảnh tổng hợp có nhiễu.
FOUND_CASES = [
    ("nen_toi", lambda: S.paper(S.flat((55, 60, 62)), BOX), BOX, 0.97),
    ("nghieng_nen_go", lambda: S.paper(wood(), TILT), TILT, 0.97),
    ("phoi_canh", lambda: S.paper(S.flat((70, 90, 110)), PERSP), PERSP, 0.97),
    ("nho_xa", lambda: S.paper(wood(), SMALL), SMALL, 0.95),
    ("giay_trang_ban_sang", lambda: S.paper(S.flat((205, 205, 200)), TILT, color=(245, 245, 245)), TILT, 0.95),
    ("xoay_45_do", lambda: S.paper(S.flat((60, 70, 65)), DIAMOND), DIAMOND, 0.97),
    ("gan_kin_khung", lambda: S.paper(S.flat((60, 70, 65)), FILLS_FRAME), FILLS_FRAME, 0.97),
    ("mo_rung", lambda: cv2.GaussianBlur(S.paper(wood(), TILT), (0, 0), 5), TILT, 0.95),
    ("khong_chu_khong_ke", lambda: S.paper(S.flat((55, 60, 62)), BOX, text=False, lines=False), BOX, 0.97),
]


@pytest.mark.parametrize("name,make,corners,min_ji", FOUND_CASES, ids=[c[0] for c in FOUND_CASES])
def test_tim_thay_tai_lieu(name, make, corners, min_ji):
    r = detect(S.noise(make()))
    assert r["found"], r.get("debug")
    assert quad_jaccard(r["corners"], truth(corners)) >= min_ji
    assert r["confidence"] > 0.5


def test_so_xoan_day_cap_goc_gap():
    """Ca giống ảnh ví dụ: gáy xoắn, dây cáp cắt mép phải, góc dưới phải bị gấp, nền gỗ có khe song song mép giấy."""
    img, corners = S.notebook_on_wood()
    r = detect(img)
    assert r["found"]
    assert quad_jaccard(r["corners"], truth(corners)) >= 0.93


def test_khong_co_giay_thi_khong_bao_tim_thay():
    r = detect(S.noise(wood()))
    assert not r["found"] and r["reason"] == "none"


def test_anh_mot_mau_la_lowContrast():
    r = detect(S.flat((120, 120, 120)))
    assert not r["found"] and r["reason"] == "lowContrast"


def test_hop_dong_ket_qua():
    r = detect(S.noise(S.paper(S.flat((55, 60, 62)), BOX)))
    assert {"found", "bbox", "corners", "areaRatio", "touches", "confidence", "method"} <= r.keys()
    assert len(r["corners"]) == 4
    assert set(r["touches"]) == {"left", "right", "top", "bottom"}
    assert all(0 <= c["x"] <= 1 and 0 <= c["y"] <= 1 for c in r["corners"])
    # Thứ tự TL, TR, BR, BL
    tl, tr, br, bl = r["corners"]
    assert tl["x"] < tr["x"] and bl["x"] < br["x"] and tl["y"] < bl["y"] and tr["y"] < br["y"]
    json.dumps(r)  # phải serialize được


def test_cham_mep_anh():
    r = detect(S.noise(S.paper(S.flat((60, 70, 65)), TOUCHES_EDGES)))
    assert r["found"]
    assert r["touches"]["left"] and r["touches"]["top"] and r["touches"]["right"] and not r["touches"]["bottom"]


def test_anh_lon_va_anh_nho_cho_cung_ket_qua():
    base = S.noise(S.paper(wood(), TILT))
    big = cv2.resize(base, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    a, b = detect(base), detect(big)
    assert a["found"] and b["found"]
    assert quad_jaccard(a["corners"], b["corners"]) > 0.97


def test_registry():
    versions = [d["version"] for d in list_detectors()]
    assert DEFAULT_VERSION in versions and "v1" in versions
    with pytest.raises(KeyError):
        get_detector("v999")


EXAMPLE = Path(__file__).resolve().parents[2] / "document" / "detect" / "example.jpg"


@pytest.mark.skipif(not EXAMPLE.exists(), reason="không có ảnh ví dụ của tài liệu nghiên cứu")
def test_anh_vi_du_cua_tai_lieu():
    """Ảnh thật (iPhone Notes): sổ xoắn trên nền gỗ, dây tai nghe. Góc kỳ vọng đo từ khung Apple vẽ trong ảnh."""
    r = detect(cv2.imread(str(EXAMPLE)))
    assert r["found"]
    expected = [(0.20, 0.29), (0.85, 0.305), (0.83, 0.75), (0.105, 0.72)]
    assert quad_jaccard(r["corners"], truth(expected)) >= 0.95
