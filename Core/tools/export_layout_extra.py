"""Model phụ cho app (checkpoint chính thức của PaddlePaddle, ghim phiên bản):

  - PP-LCNet_x1_0_doc_ori (hướng trang 0/90/180/270, đầu vào 224) -> App/assets/layout/pp_lcnet_doc_ori.onnx
  - (chỉ khi có --l) PP-DocLayout-L (RT-DETR-L, 23 lớp như S, đầu vào 640x640): checkpoint Paddle -> ONNX ->
    trọng số LƯU fp16 + Cast về fp32 lúc nạp (mọi phép tính vẫn fp32): 129 MB -> 65 MB, khớp Paddle gốc 37/37 khung.
    Ra App/assets/layout/pp_doclayout_l_f16w.onnx. APP KHÔNG DÙNG model này: trên iPhone (iOS 18, WKWebView +
    onnxruntime-web 1 luồng) bước suy luận của L không bao giờ xong (> 120 s) — đã thử bản uint8 động (34 MB, máy
    tính ~1,9 s), bản fp32 (~2,9 s) đều vậy, trong khi S (PicoDet) chỉ 0,13 s; WebView iOS 18 cũng không có WebGPU
    (bản fp16 + WebGPU ~1,5 s trên GPU Intel). Giữ lại để thử trên máy tính / bản native.

Chạy (từ Core/, môi trường .tools/paddle-venv: paddlepaddle==3.1.1 paddle2onnx==2.1.0 onnxruntime onnx pyyaml):
    ..\.tools\paddle-venv\Scripts\python.exe -m tools.export_layout_extra [--l [ảnh ...]]
      ảnh ... : so khung của bản L (và fp32) với Paddle gốc trên từng ảnh
In label_list của từng model: phải khớp MODELS trong App/web/layout.js.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import numpy as np
import yaml

CORE = Path(__file__).resolve().parents[1]
OUT_DIR = CORE.parent / "App" / "assets" / "layout"
CACHE = CORE / ".cache" / "models"

L = {
    "repo": "PaddlePaddle/PP-DocLayout-L",
    "revision": "ca760c3336d922ee63cdbff85003181222e3911c",
    "files": ["inference.json", "inference.pdiparams", "inference.yml"],
    "out": "pp_doclayout_l_f16w.onnx",
    "side": 640,
}
DOC_ORI = {
    "repo": "PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx",
    "revision": "7330ab7039123e46af2dc03154b9969aa412c61d",
    "files": ["inference.onnx", "inference.yml"],
    "out": "pp_lcnet_doc_ori.onnx",
}


def fetch(m: dict) -> Path:
    d = CACHE / m["repo"].split("/")[1]
    d.mkdir(parents=True, exist_ok=True)
    for name in m["files"]:
        dst = d / name
        if not dst.exists():
            url = f"https://huggingface.co/{m['repo']}/resolve/{m['revision']}/{name}"
            print("tải", url)
            urllib.request.urlretrieve(url, dst)
    return d


def labels_of(d: Path) -> list[str]:
    cfg = yaml.safe_load((d / "inference.yml").read_text(encoding="utf8"))
    return cfg.get("label_list") or cfg.get("PostProcess", {}).get("Topk", {}).get("label_list")


def export_l() -> Path:
    d = fetch(L)
    fp32 = d / "fp32.onnx"
    if not fp32.exists():
        import paddle  # noqa: F401  -- nạp DLL của Paddle trước, không thì paddle2onnx lỗi DLL trên Windows
        import paddle2onnx

        paddle2onnx.export(str(d / "inference.json"), str(d / "inference.pdiparams"), str(fp32),
                           opset_version=16, enable_onnx_checker=True)
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    m = onnx.load(str(fp32))
    g = m.graph
    inits, casts = [], []
    for init in list(g.initializer):
        if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 1024:
            half = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + "__f16")
            inits.append(half)
            casts.append(helper.make_node("Cast", [half.name], [init.name], to=TensorProto.FLOAT, name=init.name + "__cast"))
            g.initializer.remove(init)
    g.initializer.extend(inits)
    for c in reversed(casts):
        g.node.insert(0, c)
    out = OUT_DIR / L["out"]
    onnx.save(m, str(out))
    labels = labels_of(d)
    print(f"L: {out} ({out.stat().st_size / 1e6:.1f} MB), {len(labels)} nhãn: {labels}")
    return d


def compare_l(d: Path, images: list[str]) -> None:
    """Paddle gốc vs ONNX fp32 vs bản trong app (tiền xử lý như inference.yml: cubic 640x640, chia 255)."""
    import cv2
    import onnxruntime as ort
    from paddle import inference

    cfg = inference.Config(str(d / "inference.json"), str(d / "inference.pdiparams"))
    cfg.disable_gpu()
    pred = inference.create_predictor(cfg)
    s32 = ort.InferenceSession(str(d / "fp32.onnx"))
    s8 = ort.InferenceSession(str(OUT_DIR / L["out"]))
    S = L["side"]

    def iou(a, b):
        iw = max(0, min(a[2], b[2]) - max(a[0], b[0]))
        ih = max(0, min(a[3], b[3]) - max(a[1], b[1]))
        i = iw * ih
        return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)

    def matched(ref, got):
        used, ok = set(), 0
        for r in ref:
            for j, g in enumerate(got):
                if j not in used and g[0] == r[0] and iou(r[2:], g[2:]) >= 0.9:
                    used.add(j)
                    ok += 1
                    break
        return ok

    total = ok = 0
    for p in images:
        bgr = cv2.imread(p)
        if bgr is None:
            raise SystemExit(f"không đọc được {p}")
        h, w = bgr.shape[:2]
        x = cv2.resize(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), (S, S), interpolation=cv2.INTER_CUBIC)
        feed = {
            "im_shape": np.array([[S, S]], np.float32),
            "image": np.ascontiguousarray((x.astype(np.float32) / 255).transpose(2, 0, 1)[None]),
            "scale_factor": np.array([[S / h, S / w]], np.float32),
        }
        for n in pred.get_input_names():
            pred.get_input_handle(n).copy_from_cpu(feed[n])
        pred.run()
        keep = lambda a: a[a[:, 1] >= 0.5]  # noqa: E731
        ref = keep(pred.get_output_handle(pred.get_output_names()[0]).copy_to_cpu())
        o32, o8 = keep(s32.run(None, feed)[0]), keep(s8.run(None, feed)[0])
        total += len(ref)
        ok += matched(ref, o8)
        print(f"{Path(p).name}: Paddle {len(ref)} khung, fp32 khớp {matched(ref, o32)}, bản app khớp {matched(ref, o8)} (ra {len(o8)})")
    print(f"bản app khớp Paddle {ok}/{total} khung")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if "--l" in sys.argv:
        d = export_l()
        images = [a for a in sys.argv[1:] if not a.startswith("--")]
        if images:
            compare_l(d, images)
    o = fetch(DOC_ORI)
    out = OUT_DIR / DOC_ORI["out"]
    out.write_bytes((o / "inference.onnx").read_bytes())
    print(f"doc_ori: {out} ({out.stat().st_size / 1e6:.1f} MB), nhãn: {labels_of(o)}")


if __name__ == "__main__":
    main()
