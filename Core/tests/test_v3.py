"""Native integration tests: geometry, image layouts and web registration."""
import ctypes as C
import unittest

import cv2
import numpy as np
from fastapi.testclient import TestClient

from detect import get_detector, imaging
from detect.v3 import Params, Result
from detect.metrics import quad_jaccard
from web.main import app


def page():
    img = np.full((360, 480, 3), 35, np.uint8)
    points = np.array([[100, 40], [390, 65], [360, 320], [75, 295]], np.int32)
    cv2.fillConvexPoly(img, points, (225, 225, 225))
    for y in range(110, 250, 20):
        cv2.line(img, (130, y), (320, y), (70, 70, 70), 2)
    return img, [{"x": float(x / 480), "y": float(y / 360)} for x, y in points]


class NativeV3(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.det = get_detector("v3")

    def test_perspective_document_and_roi(self):
        img, truth = page()
        direct = self.det.detect(img)
        boxed = imaging.detect_letterboxed(self.det, img)
        for result in (direct, boxed):
            self.assertTrue(result["found"])
            self.assertGreater(quad_jaccard(result["corners"], truth), 0.93)
            self.assertLessEqual(result["debug"]["workSize"][0], 256)
            self.assertGreaterEqual(result["debug"]["timingsMs"]["total"], 0)
        self.assertGreater(quad_jaccard(direct["corners"], boxed["corners"]), 0.98)

    def test_blank_is_not_document(self):
        for level in (0, 114, 255):
            res = self.det.detect(np.full((256, 256, 3), level, np.uint8))
            self.assertFalse(res["found"])
            self.assertEqual(res["reason"], "lowContrast")

    def test_formats_and_noncontiguous_buffer(self):
        img, truth = page()
        padded = np.zeros((360, 500, 3), np.uint8)
        padded[:, 10:490] = img
        for data in (cv2.cvtColor(img, cv2.COLOR_BGR2GRAY),
                     cv2.cvtColor(img, cv2.COLOR_BGR2BGRA), padded[:, 10:490]):
            res = self.det.detect(data)
            self.assertTrue(res["found"])
            self.assertGreater(quad_jaccard(res["corners"], truth), 0.93)

    def test_native_rgba_and_stride(self):
        img, truth = page()
        rgba = cv2.cvtColor(img, cv2.COLOR_BGR2RGBA)
        padded = np.zeros((360, 500, 4), np.uint8)
        padded[:, :480] = rgba
        p = Params.from_buffer_copy(self.det.params)
        result = Result()
        code = self.det.lib.dd3_detect(padded.ctypes.data, 480, 360, padded.strides[0], 5,
                                       C.byref(p), C.byref(result))
        self.assertEqual(code, 0)
        self.assertTrue(result.found)
        corners = [{"x": float(c.x), "y": float(c.y)} for c in result.corners]
        self.assertGreater(quad_jaccard(corners, truth), 0.93)

    def test_bad_python_input_is_rejected(self):
        for data in (np.zeros((32, 32, 2), np.uint8), np.zeros((32, 32, 3), np.float32)):
            with self.assertRaises(ValueError):
                self.det.detect(data)

    def test_v2_and_v3_are_independent(self):
        v2 = get_detector("v2")
        self.assertAlmostEqual(v2.params.min_score, 0.30)
        self.assertAlmostEqual(self.det.params.min_score, 0.40)
        self.assertEqual(v2.lib.dd_version(), b"docdetect 2.0.0")
        self.assertEqual(self.det.lib.dd3_version(), b"docdetect 3.0.0")


class WebV3(unittest.TestCase):
    def test_algorithm_page_and_native_configuration(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/algorithms").status_code, 200)
            data = client.get("/api/algorithms").json()
            self.assertTrue(data["versions"]["v3"]["available"])
            self.assertAlmostEqual(data["versions"]["v3"]["params"]["min_score"], 0.40)
            for example in data["examples"]:
                self.assertEqual(len(example["gt"]), 4)
                self.assertIn(example["kind"], ("gain", "regression"))
                image = client.get(f"/api/datasets/{example['dataset']}/images/{example['id']}")
                self.assertEqual(image.status_code, 200)
            self.assertIn("v3", [d["version"] for d in client.get("/api/meta").json()["detectors"]])
            js = client.get("/static/pages/algorithms.js")
            self.assertEqual(js.status_code, 200)
            self.assertIn("approxPolyDP", js.text)


if __name__ == "__main__":
    unittest.main()
