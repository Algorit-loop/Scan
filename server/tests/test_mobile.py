import base64
import json

import cv2
import scenes as S
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
BOX = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]


def b64(img) -> str:
    return base64.b64encode(cv2.imencode(".jpg", img)[1].tobytes()).decode()


def test_health():
    r = client.get("/health").json()
    assert r["ok"] and "v1" in r["detectors"]


def test_ws_tra_ve_ket_qua_cung_dinh_dang_cu():
    img = S.noise(S.paper(S.flat((55, 60, 62)), BOX))
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"seq": 7, "image": b64(img)}))
        msg = ws.receive_json()
    assert msg["seq"] == 7 and msg["result"]["found"]
    assert {"bbox", "corners", "areaRatio", "touches", "confidence"} <= msg["result"].keys()
    assert "debug" not in msg["result"]  # không gửi phần debug nặng về điện thoại
    assert set(msg["timings"]) == {"decode", "detect"}


def test_ws_anh_hong_bao_loi_va_giu_ket_noi():
    img = S.noise(S.paper(S.flat((55, 60, 62)), BOX))
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"seq": 1, "image": "!!!"}))
        assert "error" in ws.receive_json()
        ws.send_text(json.dumps({"seq": 2, "image": b64(img)}))
        assert ws.receive_json()["result"]["found"]


def test_ws_phien_ban_khong_ton_tai():
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"seq": 1, "image": b64(S.flat((9, 9, 9))), "version": "v999"}))
        assert "error" in ws.receive_json()


def test_warp():
    img = S.paper(S.flat((55, 60, 62)), BOX)
    corners = [{"x": x, "y": y} for x, y in BOX]
    r = client.post("/warp", json={"image": b64(img), "corners": corners}).json()
    assert abs(r["width"] - 0.6 * S.W) < 4 and abs(r["height"] - 0.6 * S.H) < 4
    assert client.post("/warp", json={"image": b64(img), "corners": corners[:3]}).status_code == 400
