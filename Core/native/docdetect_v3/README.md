# docdetect v3

Independent clone of `../docdetect` (v2). All image processing, candidate generation,
ranking and corner refinement runs in C++17. The Python package `Core/detect/v3`
is a ctypes adapter, not a second detector implementation.

## Build on Windows

The repository's v2 build installs minimal static OpenCV in `.tools/opencv-mingw`.
Once that installation exists, run from the repository root:

```powershell
.\Core\native\docdetect_v3\build.ps1
```

This builds `build/docdetect_v3.dll` with MinGW, `-O3`, and static C++ runtime.
Stop processes using this DLL before rebuilding it. v2 uses a different DLL.

## CMake / mobile integration

`CMakeLists.txt` accepts the OpenCV SDK through `OpenCV_DIR`. Set
`DOCDETECT_SHARED=OFF` for a static library; the target is `docdetect_v3`.
Only OpenCV `core` and `imgproc` are linked. Supply the platform's CMake
toolchain, ABI and release configuration when integrating into Android/iOS.
These mobile builds and their performance have not been validated here.

The public header is `include/docdetect.h`. Types/constants/functions use
`dd3_` / `DD3_`, and the internal namespace is `dd3`, so v2 and v3 can coexist.

```cpp
#include "docdetect.h" // include directory: native/docdetect_v3/include

dd3_params params;
dd3_default_params(&params);
dd3_set_num_threads(1); // configure at initialization, not per concurrent call
dd3_result result{};
int status = dd3_detect(pixels, width, height, row_stride_bytes,
                       DD3_BGRA, &params, &result);
if (status == 0 && result.found) {
    // result.corners: TL, TR, BR, BL; normalized to the entire input buffer.
}
```

Buffers are borrowed only for the duration of the call. GRAY, BGR, BGRA and RGBA
are supported; planar camera YUV must be converted before this API. `roi_*`
limits the search region but returned native coordinates still reference the
whole input buffer. Positive row stride is in bytes. Caller-owned buffers must
remain valid throughout the call.

## Changes from v2

- Keep up to 60 line candidates using coverage and area in the prescore.
- Reject region contours that cannot be approximated as a supported convex
  quadrilateral; remove the unconditional minimum-area-rectangle fallback.
- Add up to 24 Canny contour candidates from two threshold pairs.
- Lower the inner-color consistency penalty for multicolored documents;
  reduce assumed border evidence; penalize very weak sides.
- Rank accepted candidates by `score * areaRatio^0.25` to favor the outer page
  over an internal photo or text box. Acceptance threshold is 0.40.
- Refine the winning quadrilateral on the original gray image with gradient
  sampling and Huber line fitting. Reject the entire refinement if evidence is
  insufficient or any corner moves more than 5 working pixels.

The detailed Vietnamese explanation, live parameter values and measured
comparison are available on the Core web page `/algorithms`.

## Evaluation and limitations

From `Core/`:

```powershell
.venv\Scripts\python.exe -m tools.compare_versions --phase development --limit 250 --output reports/v3-development.json
.venv\Scripts\python.exe -m tools.compare_versions --phase validation --limit 600 --output reports/v3-validation.json
.venv\Scripts\python.exe -m tools.evaluate --version v3 --size 256
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Both versions must be built for paired comparison. `DOCDETECT_LIB` and
`DOCDETECT_V3_LIB` override the respective library paths; `DOCDETECT_THREADS`
defaults to 1. Comparison warms each detector using a real image and alternates
execution order. Timing excludes image decoding and letterbox preparation.

Development and validation have disjoint IDs, grouping SmartDoc by video.
Validation summaries were reviewed during development, so this is not an
untouched final test. Near duplicates across datasets have not been eliminated.
Measure generalization on independently captured camera sequences and measure
latency on actual phones before enabling automatic capture.

This remains a geometric detector: tables, screens and other rectangular
objects can be false positives. `confidence` is a heuristic score, not a
calibrated probability. Debug score/coverage/contrast/area describe the selected
candidate before corner refinement. The returned corners include refinement.
