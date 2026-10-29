import cv2
import pytest
import scenes as S
from fastapi.testclient import TestClient

from app import config
from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    return TestClient(app)


def jpeg(img) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()


BOX = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]


def upload(client, img, name="anh.jpg", **params):
    return client.post("/api/detections", params={"filename": name, **params}, content=jpeg(img), headers={"Content-Type": "image/jpeg"})


@pytest.fixture()
def doc_img():
    return S.noise(S.paper(S.flat((55, 60, 62)), BOX))


def test_trang_chu_va_file_tinh(client):
    r = client.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    for f in ("style.css", "app.js"):
        assert client.get(f"/static/{f}").status_code == 200


def test_danh_sach_phien_ban(client):
    versions = client.get("/api/detectors").json()
    assert any(v["version"] == "v1" and v["default"] for v in versions)


def test_upload_luu_ket_qua_va_doc_lai(client, tmp_path, doc_img):
    r = upload(client, doc_img, "bai tap.jpg")
    assert r.status_code == 200
    rec = r.json()
    assert rec["result"]["found"] and rec["version"] == "v1" and rec["filename"] == "bai tap.jpg"
    assert rec["imageSize"] == [S.W, S.H]
    assert set(rec["files"]) == {"original", "annotated", "thumb", "warped"}

    # Đã ghi ra thư mục data
    folder = tmp_path / "detections" / rec["id"]
    assert (folder / "result.json").exists()
    for name in rec["files"].values():
        assert (folder / name).stat().st_size > 0

    # Đọc lại qua API
    assert client.get(f"/api/detections/{rec['id']}").json()["result"]["corners"] == rec["result"]["corners"]
    for kind in rec["files"]:
        f = client.get(f"/api/detections/{rec['id']}/files/{kind}")
        assert f.status_code == 200 and f.headers["content-type"].startswith("image/")

    listing = client.get("/api/detections").json()
    assert [i["id"] for i in listing] == [rec["id"]]
    assert listing[0]["found"] is True and "debug" not in listing[0]


def test_khong_thay_tai_lieu_van_luu_nhung_khong_co_anh_phang(client):
    r = upload(client, S.noise(S.wood(__import__("numpy").random.default_rng(3))))
    rec = r.json()
    assert r.status_code == 200 and not rec["result"]["found"]
    assert "warped" not in rec["files"]
    assert client.get(f"/api/detections/{rec['id']}/files/warped").status_code == 404


def test_danh_sach_moi_nhat_truoc(client, doc_img):
    a = upload(client, doc_img, "a.jpg").json()["id"]
    b = upload(client, doc_img, "b.jpg").json()["id"]
    ids = [i["id"] for i in client.get("/api/detections").json()]
    assert ids == sorted([a, b], reverse=True)


def test_xoa(client, tmp_path, doc_img):
    rec = upload(client, doc_img).json()
    assert client.delete(f"/api/detections/{rec['id']}").json() == {"ok": True}
    assert not (tmp_path / "detections" / rec["id"]).exists()
    assert client.get(f"/api/detections/{rec['id']}").status_code == 404
    assert client.delete(f"/api/detections/{rec['id']}").status_code == 404


def test_loi_dau_vao(client, doc_img):
    assert client.post("/api/detections", content=b"khong phai anh").status_code == 400
    assert client.post("/api/detections", content=b"").status_code == 400
    assert upload(client, doc_img, version="v999").status_code == 400


def test_id_khong_hop_le_khong_doc_duoc_file_ngoai_data(client):
    assert client.get("/api/detections/..%2F..%2Fapp/files/original").status_code == 404
    assert client.delete("/api/detections/not-an-id").status_code == 404
    assert client.get("/api/detections/20260101-000000-abcd/files/..").status_code == 404


def test_png_duoc_giu_nguyen_dinh_dang(client, tmp_path, doc_img):
    png = cv2.imencode(".png", doc_img)[1].tobytes()
    rec = client.post("/api/detections", params={"filename": "a.png"}, content=png).json()
    assert rec["files"]["original"] == "original.png"
    assert (tmp_path / "detections" / rec["id"] / "original.png").read_bytes() == png
