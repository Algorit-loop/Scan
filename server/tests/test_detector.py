import base64
import json

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import detector
from app.main import app

W, H = 480, 640


def make_scene(corners, bg=60, fg=225, text=True, noise=8, seed=0):
    """Nền tối + tờ giấy sáng hình tứ giác (tọa độ chuẩn hóa), có dòng chữ đen bên trong."""
    rng = np.random.default_rng(seed)
    img = np.full((H, W, 3), bg, np.uint8)
    pts = np.array([[x * W, y * H] for x, y in corners], np.int32)
    cv2.fillConvexPoly(img, pts, (fg, fg, fg))
    if text:
        x0, y0 = pts.min(axis=0)
        x1, y1 = pts.max(axis=0)
        for yy in range(int(y0 + 0.15 * (y1 - y0)), int(y1 - 0.1 * (y1 - y0)), 22):
            cv2.line(img, (int(x0 + 0.2 * (x1 - x0)), yy), (int(x1 - 0.2 * (x1 - x0)), yy), (30, 30, 30), 3)
    img = img.astype(np.int16) + rng.integers(-noise, noise + 1, img.shape, dtype=np.int16)
    return np.clip(img, 0, 255).astype(np.uint8)


def corners_close(found, expected, tol=0.03):
    return all(abs(f["x"] - ex) < tol and abs(f["y"] - ey) < tol for f, (ex, ey) in zip(found, expected))


def test_tai_lieu_thang_o_giua():
    exp = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
    r = detector.detect(make_scene(exp))
    assert r["found"] and r["method"] == "edges"
    assert corners_close(r["corners"], exp)
    assert r["touches"] == {"left": False, "right": False, "top": False, "bottom": False}


def test_tai_lieu_nghieng_phoi_canh():
    exp = [(0.25, 0.15), (0.85, 0.22), (0.78, 0.85), (0.15, 0.78)]
    r = detector.detect(make_scene(exp))
    assert r["found"]
    assert corners_close(r["corners"], exp)


def test_tai_lieu_tran_ra_ngoai_khung():
    r = detector.detect(make_scene([(0.5, 0.2), (1.2, 0.2), (1.2, 0.8), (0.5, 0.8)]))
    assert r["found"]
    assert r["touches"]["right"]
    assert not r["touches"]["left"]


def test_anh_dong_mau_la_low_contrast():
    img = np.full((H, W, 3), 128, np.uint8)
    assert detector.detect(img) == {"found": False, "reason": "lowContrast"}


def test_dom_nho_khong_phai_tai_lieu():
    r = detector.detect(make_scene([(0.5, 0.5), (0.55, 0.5), (0.55, 0.54), (0.5, 0.54)], text=False))
    assert not r["found"]


def test_warp_nan_phang_dung_ti_le():
    corners = [(0.25, 0.15), (0.85, 0.22), (0.78, 0.85), (0.15, 0.78)]
    img = make_scene(corners)
    out = detector.warp(img, [{"x": x, "y": y} for x, y in corners])
    h, w = out.shape[:2]
    assert 0.5 < w / h < 1.0  # giấy dọc
    assert out.mean() > 150  # gần như toàn bộ là giấy sáng


def test_order_corners():
    pts = np.array([[10, 90], [90, 10], [10, 10], [90, 90]], np.float32)
    assert detector.order_corners(pts).tolist() == [[10, 10], [90, 10], [90, 90], [10, 90]]


@pytest.fixture
def client():
    return TestClient(app)


def b64_jpeg(img):
    return base64.b64encode(cv2.imencode(".jpg", img)[1].tobytes()).decode()


def test_health(client):
    assert client.get("/health").json()["ok"] is True


def test_websocket_tra_ket_qua_kem_seq(client):
    img = make_scene([(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)])
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"seq": 7, "image": b64_jpeg(img)}))
        msg = json.loads(ws.receive_text())
        assert msg["seq"] == 7
        assert msg["result"]["found"]
        ws.send_text(json.dumps({"seq": 8, "image": "khong-phai-anh"}))
        assert "error" in json.loads(ws.receive_text())


def test_warp_endpoint(client):
    corners = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}]
    img = make_scene([(c["x"], c["y"]) for c in corners])
    r = client.post("/warp", json={"image": b64_jpeg(img), "corners": corners}).json()
    assert r["width"] > 0 and r["height"] > 0
    assert base64.b64decode(r["image"])[:2] == b"\xff\xd8"  # JPEG
