// Cầu nối WebAssembly cho app: bọc docdetect_v3 (Core/native/docdetect_v3) + nắn phẳng phối cảnh.
// Dùng mảng float thay vì struct để JS khỏi phụ thuộc layout bộ nhớ của dd3_result.
#include <algorithm>
#include <cmath>

#include <emscripten/emscripten.h>
#include <opencv2/imgproc.hpp>

#include "docdetect.h"

extern "C" {

// Số phần tử scan_detect ghi vào `out`.
// [0] found  [1] reason  [2] confidence  [3..10] TL,TR,BR,BL (x, y chuẩn hóa 0..1)
// [11] area  [12] sharpness  [13] ms_total  [14] score
EMSCRIPTEN_KEEPALIVE int scan_result_size(void) { return 15; }

EMSCRIPTEN_KEEPALIVE int scan_detect(const unsigned char* rgba, int width, int height, float* out) {
    static bool init = false;
    if (!init) {
        dd3_set_num_threads(0);
        init = true;
    }
    dd3_params params;
    dd3_default_params(&params);
    dd3_result r{};
    int status = dd3_detect(rgba, width, height, width * 4, DD3_RGBA, &params, &r);
    std::fill(out, out + 15, 0.0f);
    if (status != 0) return status;
    out[0] = (float)r.found;
    out[1] = (float)r.reason;
    out[2] = r.confidence;
    for (int i = 0; i < 4; ++i) {
        out[3 + i * 2] = r.corners[i].x;
        out[4 + i * 2] = r.corners[i].y;
    }
    out[11] = r.area;
    out[12] = r.sharpness;
    out[13] = r.ms_total;
    out[14] = r.score;
    return 0;
}

// Nắn tứ giác `corners` (8 float, pixel ảnh vào, thứ tự TL,TR,BR,BL) thành ảnh chữ nhật out_w × out_h (RGBA).
EMSCRIPTEN_KEEPALIVE int scan_warp(const unsigned char* rgba, int width, int height, const float* corners, int out_w,
                                   int out_h, unsigned char* out) {
    if (!rgba || !corners || !out || width < 1 || height < 1 || out_w < 1 || out_h < 1) return -1;
    cv::Mat src(height, width, CV_8UC4, const_cast<unsigned char*>(rgba));
    cv::Mat dst(out_h, out_w, CV_8UC4, out);
    cv::Point2f from[4], to[4] = {{0, 0}, {(float)out_w, 0}, {(float)out_w, (float)out_h}, {0, (float)out_h}};
    for (int i = 0; i < 4; ++i) from[i] = {corners[i * 2], corners[i * 2 + 1]};
    cv::Mat M = cv::getPerspectiveTransform(from, to);
    cv::warpPerspective(src, dst, M, dst.size(), cv::INTER_LINEAR, cv::BORDER_REPLICATE);
    return 0;
}

}  // extern "C"
