import pytest

from app.detection.metrics import quad_jaccard

SQUARE = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}]


def shifted(dx):
    return [{"x": c["x"] + dx, "y": c["y"]} for c in SQUARE]


def test_giong_het_thi_bang_1():
    assert quad_jaccard(SQUARE, SQUARE) == pytest.approx(1.0)


def test_khong_giao_thi_bang_0():
    far = [{"x": 0.0, "y": 0.0}, {"x": 0.1, "y": 0.0}, {"x": 0.1, "y": 0.1}, {"x": 0.0, "y": 0.1}]
    assert quad_jaccard(SQUARE, far) == 0.0


def test_lech_ngang():
    # Hai hình vuông cạnh 0.6, lệch 0.2: giao = 0.4*0.6 = 0.24, hợp = 2*0.36 - 0.24 = 0.48 -> JI = 0.5
    assert quad_jaccard(SQUARE, shifted(0.2)) == pytest.approx(0.5, abs=0.01)
