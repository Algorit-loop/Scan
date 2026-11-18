// Điểm vào: dd3_detect() — chuẩn bị ảnh, tìm đường, sinh + chấm ứng viên, trả kết quả.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>

#include <opencv2/imgproc.hpp>

#include "internal.hpp"

using Clock = std::chrono::steady_clock;
static inline float ms_since(Clock::time_point t) {
    return std::chrono::duration<float, std::milli>(Clock::now() - t).count();
}

extern "C" {

const char* dd3_version(void) { return "docdetect 3.0.0"; }

void dd3_default_params(dd3_params* p) {
    // Mặc định cho ảnh làm việc cạnh dài 256 px (đầu vào letterbox 256×256).
    p->work_side = 256;
    p->low_contrast_std = 8.0f;
    p->close_kernel = 3;
    p->close_iterations = 2;
    p->min_segment = 0.02f;
    p->merge_angle = 0.07f;
    p->merge_dist = 2.0f;
    p->min_line_cover = 0.07f;
    p->max_lines = 24;
    p->parallel_tol = 0.55f;
    p->min_corner_angle_sin = 0.77f;
    p->min_side_separation = 0.08f;
    p->min_area_ratio = 0.04f;
    p->corner_margin = 0.05f;
    p->prescore_keep = 60;
    p->use_regions = 1;
    p->grad_sigma = 1.0f;
    p->lab_sigma = 1.0f;
    p->sample_step = 2.0f;
    p->side_trim = 0.06f;
    p->edge_window = 2;
    p->contrast_offset = 3.0f;
    p->contrast_full = 18.0f;
    p->border_credit = 0.25f;
    p->border_touch_px = 3.0f;
    p->min_score = 0.40f;
    p->confidence_full = 0.80f;
    p->roi_x = p->roi_y = p->roi_w = p->roi_h = 0;
}

void dd3_set_num_threads(int n) { cv::setNumThreads(n); }

int dd3_detect(const unsigned char* data, int width, int height, int stride, int format, const dd3_params* params,
              dd3_result* out) {
    if (!data || !out || width < 8 || height < 8) return -1;
    dd3_params P;
    if (params) P = *params; else dd3_default_params(&P);
    std::memset(out, 0, sizeof(*out));
    out->reason = DD3_NONE;

    const auto t0 = Clock::now();
    int cn = format == DD3_GRAY ? 1 : format == DD3_BGR ? 3 : (format == DD3_BGRA || format == DD3_RGBA) ? 4 : 0;
    if (!cn) return -2;
    if (!stride) stride = width * cn;
    cv::Mat full(height, width, CV_8UC(cn), const_cast<unsigned char*>(data), (size_t)stride);
    cv::Rect roi(0, 0, width, height);
    if (P.roi_w > 0 && P.roi_h > 0) roi &= cv::Rect(P.roi_x, P.roi_y, P.roi_w, P.roi_h);
    if (roi.width < 8 || roi.height < 8) return -1;
    cv::Mat src = full(roi);  // view, không copy
    const int fullW = width, fullH = height;
    width = roi.width;
    height = roi.height;

    // 1. Thu nhỏ về cạnh dài work_side rồi đổi sang BGR.
    double scale = std::min(1.0, (double)P.work_side / std::max(width, height));
    cv::Mat small;
    if (scale < 1)
        cv::resize(src, small, cv::Size((int)std::lround(width * scale), (int)std::lround(height * scale)), 0, 0,
                   cv::INTER_AREA);
    else
        small = src;
    cv::Mat bgr;
    switch (format) {
        case DD3_GRAY: cv::cvtColor(small, bgr, cv::COLOR_GRAY2BGR); break;
        case DD3_BGRA: cv::cvtColor(small, bgr, cv::COLOR_BGRA2BGR); break;
        case DD3_RGBA: cv::cvtColor(small, bgr, cv::COLOR_RGBA2BGR); break;
        default: bgr = small;
    }
    const int w = bgr.cols, h = bgr.rows;
    out->work_width = w;
    out->work_height = h;

    cv::Mat gray;
    cv::cvtColor(bgr, gray, cv::COLOR_BGR2GRAY);
    cv::Mat lap;
    cv::Laplacian(gray, lap, CV_32F);
    cv::Scalar m, sd;
    cv::meanStdDev(lap, m, sd);
    out->sharpness = (float)(sd[0] * sd[0]);
    cv::meanStdDev(gray, m, sd);
    if (sd[0] < P.low_contrast_std) {
        out->reason = DD3_LOW_CONTRAST;
        out->ms_prep = out->ms_total = ms_since(t0);
        return 0;
    }

    // 2. Đóng hình thái để xóa chữ / hình trong trang, giữ mép giấy.
    cv::Mat smooth;
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {P.close_kernel, P.close_kernel});
    cv::morphologyEx(gray, smooth, cv::MORPH_CLOSE, kernel, {-1, -1}, P.close_iterations);
    cv::Mat lab8;
    cv::cvtColor(bgr, lab8, cv::COLOR_BGR2Lab);
    out->ms_prep = ms_since(t0);

    // 3. LSD tìm đoạn thẳng -> gộp thành đường.
    const auto t1 = Clock::now();
    std::vector<cv::Vec4f> segs;
    // Tạo LSD một lần cho mỗi luồng (tạo lại mỗi khung tốn thời gian vô ích).
    static thread_local cv::Ptr<cv::LineSegmentDetector> lsd = cv::createLineSegmentDetector(cv::LSD_REFINE_STD);
    lsd->detect(smooth, segs);
    std::vector<dd3::Line> lines = dd3::merge_segments(segs, w, h, P);
    out->ms_lines = ms_since(t1);

    // 4. Sinh ứng viên + chấm điểm, lấy cao nhất.
    const auto t2 = Clock::now();
    dd3::ScoreContext ctx = dd3::build_context(smooth, lab8, P);
    std::vector<dd3::Candidate> cands = dd3::from_lines(lines, w, h, P);
    if (P.use_regions) {
        auto r = dd3::from_regions(lab8, gray, P);
        cands.insert(cands.end(), r.begin(), r.end());
        auto edges = dd3::from_edges(smooth, P);
        cands.insert(cands.end(), edges.begin(), edges.end());
    }
    int best = -1;
    float best_rank = -2;
    for (int i = 0; i < (int)cands.size(); ++i) {
        dd3::score_quad(cands[i], ctx, P);
        // Prefer the supported outer page over a smaller picture/text box.
        float rank = cands[i].score * std::sqrt(std::sqrt(std::max(0.0f, cands[i].area)));
        if (cands[i].score < P.min_score) rank -= 1;
        if (rank > best_rank) { best = i; best_rank = rank; }
    }
    out->ms_quads = ms_since(t2);
    out->ms_total = ms_since(t0);

    // Tọa độ ảnh làm việc (trong roi) -> chuẩn hóa theo cả ảnh vào.
    auto nx = [&](double x) { return (float)((roi.x + x / w * roi.width) / fullW); };
    auto ny = [&](double y) { return (float)((roi.y + y / h * roi.height) / fullH); };
    out->candidates = (int)cands.size();
    out->n_lines = std::min((int)lines.size(), DD3_MAX_LINES);
    for (int i = 0; i < out->n_lines; ++i) {
        const auto& ln = lines[i];
        cv::Point2d p0 = ln.p + ln.d * ln.iv.front().first, p1 = ln.p + ln.d * ln.iv.back().second;
        out->lines[i][0] = nx(p0.x); out->lines[i][1] = ny(p0.y);
        out->lines[i][2] = nx(p1.x); out->lines[i][3] = ny(p1.y);
    }
    if (best < 0) return 0;
    auto& c = cands[best];
    out->score = c.score;
    if (c.score < P.min_score) return 0;

    // Refine on the original gray image: morphology can move the paper edge.
    dd3::refine_quad(c.quad, gray);

    out->found = 1;
    out->reason = DD3_FOUND;
    out->method = c.source;
    out->confidence = std::min(1.0f, c.score / P.confidence_full);
    for (int i = 0; i < 4; ++i) {
        // Kẹp trong roi: góc không được nằm trên dải viền.
        out->corners[i].x = nx(std::clamp(c.quad[i].x, 0.0f, (float)w));
        out->corners[i].y = ny(std::clamp(c.quad[i].y, 0.0f, (float)h));
        out->coverage[i] = c.coverage[i];
        out->contrast[i] = c.contrast[i];
    }
    out->consistency = c.consistency;
    out->area = c.area;
    out->ms_quads = ms_since(t2);
    out->ms_total = ms_since(t0);
    return 0;
}

}  // extern "C"
