"""Chuyển PP-DocLayout-S (checkpoint Paddle chính thức) sang ONNX cho app, rồi đối chiếu với Paddle gốc.

Cần môi trường riêng có Paddle (không cài vào Core/.venv):
    python -m venv .tools/paddle-venv
    .tools/paddle-venv/Scripts/python.exe -m pip install paddlepaddle==3.1.1 paddle2onnx==2.1.0 onnxruntime pyyaml
    (--paddlex-ref cần thêm: paddlex pypdfium2 opencv-contrib-python)
    (paddle2onnx 2.1.0 chỉ chạy với paddlepaddle 3.1.x; bản 3.3 lỗi "DLL load failed".)
Chạy (từ Core/):
    ..\\.tools\\paddle-venv\\Scripts\\python.exe -m tools.export_layout_onnx [ảnh ...] [--skip-export] [--paddlex-ref]
      ảnh ...        : so đầu ra ONNX với Paddle gốc trên từng ảnh (phải trùng)
      --paddlex-ref  : ghi thêm <ảnh>.json = kết quả PaddleX để App/scripts/check-layout.mjs so khớp

Ra: App/assets/layout/pp_doclayout_s.onnx. Nhãn (label_list) phải khớp LABELS trong App/web/layout.js.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import yaml

CORE = Path(__file__).resolve().parents[1]
PROJECT = CORE.parent
REPO = "PaddlePaddle/PP-DocLayout-S"
REVISION = "8ac289e66575bb9bba6e15c53719d8b15cc9b3b2"  # ghim bản trên Hugging Face
FILES = ["inference.json", "inference.pdiparams", "inference.yml"]
SRC = CORE / ".cache" / "models" / "PP-DocLayout-S"
OUT = PROJECT / "App" / "assets" / "layout" / "pp_doclayout_s.onnx"
SIDE = 480
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def download() -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        dst = SRC / name
        if dst.exists():
            continue
        url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
        print("tải", url)
        urllib.request.urlretrieve(url, dst)


def export() -> None:
    import paddle  # noqa: F401  -- nạp DLL của Paddle trước, không thì paddle2onnx lỗi DLL trên Windows
    import paddle2onnx

    OUT.parent.mkdir(parents=True, exist_ok=True)
    paddle2onnx.export(
        str(SRC / "inference.json"),
        str(SRC / "inference.pdiparams"),
        str(OUT),
        opset_version=16,
        enable_onnx_checker=True,
    )
    print(f"ghi {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


def preprocess(bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Đúng inference.yml: Resize 480x480 (interp 2 = cubic, không giữ tỉ lệ), chia 255, chuẩn hóa ImageNet, CHW."""
    h, w = bgr.shape[:2]
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    x = cv2.resize(rgb, (SIDE, SIDE), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255.0
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None]
    return np.ascontiguousarray(x), np.array([[SIDE / h, SIDE / w]], np.float32)


def run_paddle(image: np.ndarray, scale: np.ndarray) -> np.ndarray:
    from paddle import inference

    cfg = inference.Config(str(SRC / "inference.json"), str(SRC / "inference.pdiparams"))
    cfg.disable_gpu()
    pred = inference.create_predictor(cfg)
    feed = {"image": image, "scale_factor": scale}
    for name in pred.get_input_names():
        pred.get_input_handle(name).copy_from_cpu(feed[name])
    pred.run()
    dets = pred.get_output_handle(pred.get_output_names()[0]).copy_to_cpu()
    num = int(pred.get_output_handle(pred.get_output_names()[1]).copy_to_cpu().reshape(-1)[0])
    return dets[:num]


def run_onnx(image: np.ndarray, scale: np.ndarray) -> np.ndarray:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(OUT), providers=["CPUExecutionProvider"])
    names = [i.name for i in sess.get_inputs()]
    dets, num = sess.run(None, {"image": image, "scale_factor": scale} if "image" in names else dict(zip(names, (image, scale))))
    return dets[: int(np.asarray(num).reshape(-1)[0])]


def compare(path: Path, labels: list[str]) -> None:
    bgr = cv2.imread(str(path))
    if bgr is None:
        raise SystemExit(f"không đọc được {path}")
    image, scale = preprocess(bgr)
    ref, got = run_paddle(image, scale), run_onnx(image, scale)
    ref, got = ref[ref[:, 1] >= 0.5], got[got[:, 1] >= 0.5]
    print(f"\n{path.name}: Paddle {len(ref)} vùng, ONNX {len(got)} vùng (điểm >= 0.5)")
    if len(ref) != len(got):
        raise SystemExit("số vùng khác nhau")
    ref, got = ref[np.lexsort(ref.T[::-1])], got[np.lexsort(got.T[::-1])]
    d = np.abs(ref - got).max(axis=0) if len(ref) else np.zeros(6)
    print(f"  lệch lớn nhất: lớp {d[0]:.0f}, điểm {d[1]:.4f}, tọa độ {d[2:].max():.2f} px")
    for row in got:
        print(f"  {labels[int(row[0])]:<16} {row[1]:.2f}  [{row[2]:.0f}, {row[3]:.0f}, {row[4]:.0f}, {row[5]:.0f}]")
    if d[0] > 0 or d[1] > 1e-3 or d[2:].max() > 0.5:
        raise SystemExit("ONNX lệch Paddle quá mức cho phép")


def paddlex_reference(paths: list[Path]) -> None:
    """Ghi <ảnh>.json = kết quả PaddleX (threshold 0.3, layout_nms) để App/scripts/check-layout.mjs so khớp.
    Cần thêm: pip install paddlex pypdfium2 opencv-contrib-python."""
    import os

    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddlex import create_model

    model = create_model("PP-DocLayout-S", model_dir=str(SRC), device="cpu")
    for p in paths:
        res = next(iter(model.predict(str(p), batch_size=1, threshold=0.3, layout_nms=True)))
        boxes = [{"cls_id": int(b["cls_id"]), "label": b["label"], "score": float(b["score"]),
                  "coordinate": [float(v) for v in b["coordinate"]]} for b in res["boxes"]]
        p.with_suffix(".json").write_text(json.dumps(boxes, ensure_ascii=False), encoding="utf8")
        print(f"PaddleX {p.name}: {len(boxes)} vùng -> {p.with_suffix('.json').name}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    download()
    labels = yaml.safe_load((SRC / "inference.yml").read_text(encoding="utf8"))["label_list"]
    (SRC / "labels.json").write_text(json.dumps(labels), encoding="utf8")
    if "--skip-export" not in sys.argv:
        export()
    for p in args:
        compare(Path(p), labels)
    if "--paddlex-ref" in sys.argv:
        paddlex_reference([Path(p) for p in args])


if __name__ == "__main__":
    main()
