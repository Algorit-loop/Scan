// Chấm điểm tứ giác: điểm mỗi cạnh = độ phủ biên thật × tương phản trong/ngoài; gộp 4 cạnh có xét cạnh yếu nhất.
#include <algorithm>
#include <cmath>

#include <opencv2/imgproc.hpp>

#include "internal.hpp"

namespace dd3 {

ScoreContext build_context(const cv::Mat& smooth_gray, const cv::Mat& lab8, const dd3_params& P) {
    ScoreContext ctx;
    ctx.w = smooth_gray.cols;
    ctx.h = smooth_gray.rows;
    cv::Mat g;
    smooth_gray.convertTo(g, CV_32F);
    cv::GaussianBlur(g, g, cv::Size(), P.grad_sigma);
    cv::Sobel(g, ctx.gx, CV_32F, 1, 0, 3, 1.0 / 8);
    cv::Sobel(g, ctx.gy, CV_32F, 0, 1, 3, 1.0 / 8);

    // Ngưỡng biên = 30% phân vị 97 của độ lớn gradient (tự thích nghi với độ tương phản của ảnh).
    cv::Mat mag;
    cv::magnitude(ctx.gx, ctx.gy, mag);
    std::vector<float> v(mag.begin<float>(), mag.end<float>());
    auto k = v.begin() + (size_t)(0.97 * (v.size() - 1));
    std::nth_element(v.begin(), k, v.end());
    ctx.edge_thresh = std::max(4.0f, 0.3f * *k);

    lab8.convertTo(ctx.lab, CV_32FC3);
    cv::GaussianBlur(ctx.lab, ctx.lab, cv::Size(), P.lab_sigma);
    return ctx;
}

namespace {

inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

template <typename T>
inline const T& at(const cv::Mat& m, float x, float y) {
    int xi = clampi((int)std::lrint(x), 0, m.cols - 1);
    int yi = clampi((int)std::lrint(y), 0, m.rows - 1);
    return m.ptr<T>(yi)[xi];
}

float median_inplace(std::vector<float>& v) {
    if (v.empty()) return 0;
    size_t n = v.size(), m = n / 2;
    std::nth_element(v.begin(), v.begin() + m, v.end());
    float hi = v[m];
    if (n % 2) return hi;
    float lo = *std::max_element(v.begin(), v.begin() + m);
    return 0.5f * (lo + hi);
}

struct SideMetrics {
    float cover = 0, contrast = 0;
    bool has_color = false;
    cv::Vec3f color;
};

SideMetrics side_metrics(cv::Point2f a, cv::Point2f b, const ScoreContext& ctx, const dd3_params& P) {
    SideMetrics r;
    cv::Point2f e = b - a;
    float length = std::sqrt(e.dot(e));
    if (length < 1) return r;
    cv::Point2f d = e / length;
    cv::Point2f nin(-d.y, d.x);  // pháp tuyến hướng vào trong (tứ giác theo chiều kim đồng hồ)
    int k = std::max(4, (int)(length / P.sample_step));
    const float w1 = (float)ctx.w - 1, h1 = (float)ctx.h - 1;
    auto valid = [&](cv::Point2f p) { return p.x >= 0 && p.x <= w1 && p.y >= 0 && p.y <= h1; };

    thread_local std::vector<float> diff, cin[3];
    diff.clear();
    for (auto& c : cin) c.clear();
    int n_assumed = 0;
    double cover_sum = 0;
    for (int i = 0; i < k; ++i) {
        float t = P.side_trim + (1 - 2 * P.side_trim) * (k == 1 ? 0.f : (float)i / (k - 1));
        cv::Point2f p = a + e * t;
        cv::Point2f pin = p + nin * P.contrast_offset, pout = p - nin * P.contrast_offset;
        bool in_ok = valid(pin), out_ok = valid(pout);
        float border = std::min(std::min(p.x, p.y), std::min(w1 - p.x, h1 - p.y));
        bool assumed = in_ok && !out_ok && border <= P.border_touch_px;
        if (assumed) {
            cover_sum += P.border_credit;
            ++n_assumed;
        } else if (in_ok && out_ok) {
            float gmax = 0;
            for (int o = -P.edge_window; o <= P.edge_window; ++o) {
                cv::Point2f q = p + nin * (float)o;
                float g = at<float>(ctx.gx, q.x, q.y) * nin.x + at<float>(ctx.gy, q.x, q.y) * nin.y;
                gmax = std::max(gmax, std::abs(g));
            }
            if (gmax >= ctx.edge_thresh) cover_sum += 1;
        }
        if (in_ok) {
            const cv::Vec3f& ci = at<cv::Vec3f>(ctx.lab, pin.x, pin.y);
            for (int c = 0; c < 3; ++c) cin[c].push_back(ci[c]);
            if (out_ok) {
                const cv::Vec3f& co = at<cv::Vec3f>(ctx.lab, pout.x, pout.y);
                cv::Vec3f dv = ci - co;
                diff.push_back(std::sqrt(dv.dot(dv)));
            }
        }
    }
    r.cover = (float)(cover_sum / k);
    r.contrast = median_inplace(diff);
    if ((float)n_assumed / k > 0.5f) r.contrast = std::max(r.contrast, P.contrast_full * P.border_credit);
    if (!cin[0].empty()) {
        r.has_color = true;
        for (int c = 0; c < 3; ++c) r.color[c] = median_inplace(cin[c]);
    }
    return r;
}

}  // namespace

void score_quad(Candidate& cand, const ScoreContext& ctx, const dd3_params& P) {
    float lens[4], ss[4];
    cv::Vec3f cols[4];
    int ncol = 0;
    float lsum = 0, wsum = 0, smin = 1e9f;
    for (int i = 0; i < 4; ++i) {
        cv::Point2f a = cand.quad[i], b = cand.quad[(i + 1) % 4];
        SideMetrics m = side_metrics(a, b, ctx, P);
        cv::Point2f e = b - a;
        lens[i] = std::sqrt(e.dot(e));
        cand.coverage[i] = m.cover;
        cand.contrast[i] = std::min(1.0f, m.contrast / P.contrast_full);
        ss[i] = cand.coverage[i] * cand.contrast[i];
        if (m.has_color) cols[ncol++] = m.color;
        lsum += lens[i];
        wsum += ss[i] * lens[i];
        smin = std::min(smin, ss[i]);
    }
    float mean = wsum / std::max(lsum, 1e-6f);
    float overall = 0.65f * mean + 0.35f * smin;

    // Màu phía trong 4 cạnh phải giống nhau (cùng là mặt giấy); lệch nhiều = tứ giác vắt qua nhiều vật.
    float consistency = 1;
    if (ncol >= 2) {
        float spread = 0;
        for (int i = 0; i < ncol; ++i)
            for (int j = i + 1; j < ncol; ++j) {
                cv::Vec3f dv = cols[i] - cols[j];
                spread = std::max(spread, std::sqrt(dv.dot(dv)));
            }
        consistency = 1 - std::min(0.2f, std::max(0.0f, (spread - 15.0f) / 80.0f));
    }
    float area = (float)(polygon_area(cand.quad) / ((double)ctx.w * ctx.h));
    float size_factor = 0.85f + 0.15f * std::min(1.0f, area / 0.5f);
    cand.consistency = consistency;
    cand.area = area;
    cand.score = overall * consistency * size_factor;
    // A long pair of strong edges must not hide two unsupported sides.
    float weakest = *std::min_element(cand.coverage, cand.coverage + 4);
    if (weakest < 0.10f || smin < 0.03f) cand.score *= 0.5f;
}

}  // namespace dd3
