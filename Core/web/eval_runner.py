"""Chạy tools/evaluate.py từ trang web: mỗi lần một tiến trình con, theo hàng đợi các bộ dữ liệu.

Chạy bằng tiến trình con (không phải thread) để detect không tranh GIL với server và số đo thời gian
giống khi chạy tay. Tiến độ đọc từ các dòng `@@PROGRESS {...}` mà script in ra.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time

from paths import CORE_DIR

_lock = threading.Lock()
_state: dict = {"running": False}
_proc: subprocess.Popen | None = None
_cancel = False


def status() -> dict:
    with _lock:
        s = dict(_state)
    if s.get("running") and s.get("total"):
        el = time.time() - s["datasetStartedAt"]
        done = s["done"]
        s["percent"] = round(done / s["total"] * 100, 1)
        s["etaSeconds"] = round(el / done * (s["total"] - done)) if done else None
    return s


def start(version: str, datasets: list[str], limit: int | None = None, size: int = 256) -> dict:
    global _cancel
    with _lock:
        if _state.get("running"):
            raise RuntimeError("Đang có một lượt đánh giá chạy")
        _cancel = False
        _state.clear()
        _state.update({
            "running": True, "version": version, "queue": list(datasets), "finished": [], "limit": limit, "size": size,
            "dataset": None, "done": 0, "total": 0, "startedAt": time.time(), "error": None, "cancelled": False,
        })
    threading.Thread(target=_run, daemon=True).start()
    return status()


def cancel() -> None:
    global _cancel
    _cancel = True
    if _proc and _proc.poll() is None:
        _proc.terminate()


def _run() -> None:
    global _proc
    try:
        while True:
            with _lock:
                if _cancel or not _state["queue"]:
                    break
                ds = _state["queue"].pop(0)
                _state.update({"dataset": ds, "done": 0, "total": 0, "datasetStartedAt": time.time()})
                version, limit, size = _state["version"], _state["limit"], _state["size"]
            cmd = [sys.executable, "-u", "-m", "tools.evaluate", "--version", version, "--dataset", ds, "--size", str(size), "--progress"]
            if limit:
                cmd += ["--limit", str(limit)]
            _proc = subprocess.Popen(cmd, cwd=CORE_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     text=True, encoding="utf-8", errors="replace",
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            tail: list[str] = []
            for line in _proc.stdout:
                if line.startswith("@@PROGRESS "):
                    p = json.loads(line[11:])
                    with _lock:
                        _state["done"], _state["total"] = p["done"], p["total"]
                else:
                    tail = (tail + [line.rstrip()])[-20:]
            code = _proc.wait()
            with _lock:
                if _cancel:
                    _state["cancelled"] = True
                    break
                if code != 0:
                    _state["error"] = f"{ds}: tiến trình lỗi (mã {code})\n" + "\n".join(tail)
                    break
                _state["finished"].append(ds)
    except Exception as e:  # lỗi không lường trước — báo lên trang thay vì treo
        with _lock:
            _state["error"] = str(e)
    finally:
        with _lock:
            _state["running"] = False
            _state["endedAt"] = time.time()
        _proc = None
