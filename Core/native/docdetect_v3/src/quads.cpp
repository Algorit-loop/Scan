// Sinh ứng viên tứ giác: từ giao điểm các đường (chính) và từ vùng màu / sáng / tối (dự phòng).
#include <algorithm>
#include <cmath>

#include <opencv2/imgproc.hpp>

#include "internal.hpp"

namespace dd3 {

std::vector<Candidate> from_lines(const std::vector<Line>& lines, int w, int h, const dd3_params& P) {
    const int n = (int)lines.size();
    std::vector<Candidate> out;
    if (n < 4) return out;
    const double side = std::max(w, h);

    // Giao điểm mọi cặp đường (n ≤ 32 nên bảng nhỏ).
    std::vector<cv::Point2d> X(n * n);
    std::vector<char> ok(n * n, 0);
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j) {
            const auto &a = lines[i], &b = lines[j];
            double det = a.n.x * b.n.y - a.n.y * b.n.x;
            if (std::abs(det) < 1e-6) continue;
            X[i * n + j] = {(a.c * b.n.y - a.n.y * b.c) / det, (a.n.x * b.c - a.c * b.n.x) / det};
            ok[i * n + j] = 1;
        }

    // Cặp cạnh đối: gần song song và đủ xa nhau.
    struct Pair { int i, j; double ang; };
    std::vector<Pair> pairs;
    for (int i = 0; i < n; ++i)
        for (int j = i + 1; j < n; ++j) {
            const auto &a = lines[i], &b = lines[j];
            if (angle_diff(a.angle, b.angle) > P.parallel_tol) continue;
            cv::Point2d nm = a.n.dot(b.n) >= 0 ? a.n : -a.n;
            if (std::abs((a.p - b.p).dot(nm)) < P.min_side_separation * side) continue;
            double ang = 0.5 * std::atan2(std::sin(2 * a.angle) + std::sin(2 * b.angle),
                                          std::cos(2 * a.angle) + std::cos(2 * b.angle));
            pairs.push_back({i, j, ang});
        }

    const double mx = P.corner_margin * w, my = P.corner_margin * h;
    const double min_area = P.min_area_ratio * w * h;
    for (size_t ia = 0; ia < pairs.size(); ++ia) {
        const auto& pa = pairs[ia];
        for (size_t ib = ia + 1; ib < pairs.size(); ++ib) {
            const auto& pb = pairs[ib];
            int a = pa.i, b = pa.j, c = pb.i, d = pb.j;
            if (a == c || a == d || b == c || b == d) continue;
            if (std::abs(std::sin(pa.ang - pb.ang)) < P.min_corner_angle_sin) continue;
            // Góc theo vòng: a∩c, c∩b, b∩d, d∩a. Cạnh tương ứng nằm trên đường: c, b, d, a.
            const int ord[4][2] = {{a, c}, {c, b}, {b, d}, {d, a}};
            const int sideLine[4] = {c, b, d, a};
            Quad q;
            bool good = true;
            for (int k = 0; k < 4 && good; ++k) {
                int idx = ord[k][0] * n + ord[k][1];
                if (!ok[idx]) { good = false; break; }
                const auto& pt = X[idx];
                if (pt.x < -mx || pt.x > w + mx || pt.y < -my || pt.y > h + my) good = false;
                q[k] = cv::Point2f((float)pt.x, (float)pt.y);
            }
            if (!good || !is_convex(q) || polygon_area(q) < min_area) continue;
            double covered = 0, perim = 0;
            for (int k = 0; k < 4; ++k) {
                cv::Point2d p0 = q[k], p1 = q[(k + 1) % 4];
                covered += lines[sideLine[k]].overlap(p0, p1);
                perim += cv::norm(p1 - p0);
            }
            if (perim <= 0) continue;
            Candidate cand;
            cand.quad = order_clockwise(q);
            cand.source = DD3_LINES;
            cand.prescore = (float)(covered / perim * std::pow(polygon_area(q) / (w * h), 0.2));
            out.push_back(cand);
        }
    }
    // Chỉ giữ các ứng viên có độ phủ đường cao nhất để chấm đầy đủ.
    if ((int)out.size() > P.prescore_keep) {
        std::partial_sort(out.begin(), out.begin() + P.prescore_keep, out.end(),
                          [](const Candidate& x, const Candidate& y) { return x.prescore > y.prescore; });
        out.resize(P.prescore_keep);
    }
    return out;
}

namespace {

Quad quad_from_contour(const std::vector<cv::Point>& contour) {
    std::vector<cv::Point> hull, approx;
    cv::convexHull(contour, hull);
    double peri = cv::arcLength(hull, true);
    for (double eps : {0.02, 0.03, 0.05, 0.08}) {
        cv::approxPolyDP(hull, approx, eps * peri, true);
        if (approx.size() == 4) {
            Quad q;
            for (int i = 0; i < 4; ++i) q[i] = cv::Point2f((float)approx[i].x, (float)approx[i].y);
            return order_clockwise(q);
        }
    }
    // An arbitrary blob is not evidence for four document edges.
    return {};
}

void from_mask(cv::Mat mask, int source, int top, const dd3_params& P, std::vector<Candidate>& out) {
    const int w = mask.cols, h = mask.rows;
    int k = std::max(3, (int)std::lround(0.02 * std::max(w, h)) | 1);
    cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {k, k});
    cv::morphologyEx(mask, mask, cv::MORPH_CLOSE, kernel);
    cv::morphologyEx(mask, mask, cv::MORPH_OPEN, kernel);
    std::vector<std::vector<cv::Point>> contours;
    cv::findContours(mask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
    std::vector<std::pair<double, int>> byArea;
    for (int i = 0; i < (int)contours.size(); ++i) byArea.emplace_back(cv::contourArea(contours[i]), i);
    std::sort(byArea.begin(), byArea.end(), [](auto& x, auto& y) { return x.first > y.first; });
    const double min_area = P.min_area_ratio * w * h;
    for (int t = 0; t < std::min(top, (int)byArea.size()); ++t) {
        if (byArea[t].first < min_area) break;
        Candidate c;
        c.quad = quad_from_contour(contours[byArea[t].second]);
        c.source = source;
        double qa = polygon_area(c.quad);
        double fill = qa > 0 ? byArea[t].first / qa : 0;
        if (qa >= min_area && is_convex(c.quad) && fill >= 0.82 && fill <= 1.18)
            out.push_back(c);
    }
}

uchar median_u8(std::vector<uchar>& v) {
    auto mid = v.begin() + v.size() / 2;
    std::nth_element(v.begin(), mid, v.end());
    return *mid;
}

}  // namespace

std::vector<Candidate> from_regions(const cv::Mat& lab8, const cv::Mat& gray, const dd3_params& P) {
    std::vector<Candidate> out;
    const int w = gray.cols, h = gray.rows;

    // Màu nền = trung vị từng kênh của dải viền ảnh (giả định viền chủ yếu là nền).
    const int b = std::max(2, (int)std::lround(0.05 * std::min(w, h)));
    std::vector<uchar> ch[3];
    for (int y = 0; y < h; ++y) {
        const cv::Vec3b* row = lab8.ptr<cv::Vec3b>(y);
        bool band_row = y < b || y >= h - b;
        for (int x = 0; x < w; ++x) {
            if (!band_row && x >= b && x < w - b) { x = w - b - 1; continue; }
            for (int k = 0; k < 3; ++k) ch[k].push_back(row[x][k]);
        }
    }
    float bg[3];
    for (int k = 0; k < 3; ++k) bg[k] = median_u8(ch[k]);

    cv::Mat dist(h, w, CV_32F);
    float dmax = 1;
    for (int y = 0; y < h; ++y) {
        const cv::Vec3b* row = lab8.ptr<cv::Vec3b>(y);
        float* d = dist.ptr<float>(y);
        for (int x = 0; x < w; ++x) {
            float a = row[x][0] - bg[0], bb = row[x][1] - bg[1], c = row[x][2] - bg[2];
            d[x] = std::sqrt(a * a + bb * bb + c * c);
            dmax = std::max(dmax, d[x]);
        }
    }
    cv::Mat dist8, m;
    dist.convertTo(dist8, CV_8U, 255.0 / dmax);
    cv::threshold(dist8, m, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    from_mask(m, DD3_COLOR, 2, P, out);

    cv::Mat bright;
    cv::threshold(gray, bright, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    cv::Mat dark = ~bright;
    from_mask(bright, DD3_BRIGHT, 1, P, out);
    from_mask(dark, DD3_DARK, 1, P, out);
    return out;
}

std::vector<Candidate> from_edges(const cv::Mat& gray, const dd3_params& P) {
    std::vector<Candidate> out;
    for (int low : {20, 50}) {
        cv::Mat edges;
        cv::Canny(gray, edges, low, low * 3);
        cv::morphologyEx(edges, edges, cv::MORPH_CLOSE,
                        cv::getStructuringElement(cv::MORPH_RECT, {3, 3}));
        std::vector<std::vector<cv::Point>> contours;
        cv::findContours(edges, contours, cv::RETR_LIST, cv::CHAIN_APPROX_SIMPLE);
        for (const auto& contour : contours) {
            double area = std::abs(cv::contourArea(contour));
            if (area < P.min_area_ratio * gray.total()) continue;
            std::vector<cv::Point> approx;
            cv::approxPolyDP(contour, approx, 0.025 * cv::arcLength(contour, true), true);
            if (approx.size() != 4 || !cv::isContourConvex(approx)) continue;
            Quad q;
            for (int i = 0; i < 4; ++i) q[i] = cv::Point2f(approx[i]);
            double qa = polygon_area(q);
            if (qa < 1 || area / qa < 0.85 || area / qa > 1.15) continue;
            Candidate c;
            c.quad = order_clockwise(q);
            c.source = DD3_EDGES;
            c.prescore = (float)qa;
            out.push_back(c);
        }
    }
    std::sort(out.begin(), out.end(), [](const Candidate& a, const Candidate& b) { return a.prescore > b.prescore; });
    if (out.size() > 24) out.resize(24);
    return out;
}

void refine_quad(Quad& quad, const cv::Mat& gray) {
    cv::Mat blurred, gx, gy;
    cv::GaussianBlur(gray, blurred, {3, 3}, 0.7);
    cv::Sobel(blurred, gx, CV_32F, 1, 0, 3, 1.0 / 8);
    cv::Sobel(blurred, gy, CV_32F, 0, 1, 3, 1.0 / 8);
    std::array<cv::Vec4f, 4> fitted;
    for (int i = 0; i < 4; ++i) {
        cv::Point2f a = quad[i], b = quad[(i + 1) % 4], e = b - a;
        float length = (float)cv::norm(e);
        if (length < 8) return;
        cv::Point2f n(-e.y / length, e.x / length);
        std::vector<cv::Point2f> points;
        int count = std::max(8, (int)(length / 2));
        for (int j = 0; j < count; ++j) {
            cv::Point2f p = a + e * (0.1f + 0.8f * j / (count - 1));
            float best = 4;
            cv::Point2f selected;
            for (int offset = -3; offset <= 3; ++offset) {
                cv::Point2f q = p + n * (float)offset;
                int x = cvRound(q.x), y = cvRound(q.y);
                if (x < 1 || x >= gray.cols - 1 || y < 1 || y >= gray.rows - 1) continue;
                float dx = gx.at<float>(y, x), dy = gy.at<float>(y, x);
                float normal = std::abs(dx * n.x + dy * n.y);
                // Prefer nearby, aligned edges to text strokes or unrelated texture.
                float score = normal / (1 + 0.12f * std::abs(offset));
                if (normal >= 0.8f * std::hypot(dx, dy) && score > best) {
                    best = score; selected = q;
                }
            }
            if (best > 4) points.push_back(selected);
        }
        if (points.size() < (size_t)(count * 0.6)) return;
        cv::fitLine(points, fitted[i], cv::DIST_HUBER, 0, 0.01, 0.01);
    }
    Quad refined;
    for (int i = 0; i < 4; ++i) {
        auto a = fitted[(i + 3) % 4], b = fitted[i];
        double det = a[0] * b[1] - a[1] * b[0];
        if (std::abs(det) < 0.1) return;
        double t = ((b[2] - a[2]) * b[1] - (b[3] - a[3]) * b[0]) / det;
        refined[i] = {(float)(a[2] + t * a[0]), (float)(a[3] + t * a[1])};
        if (cv::norm(refined[i] - quad[i]) > 5) return;
    }
    if (is_convex(refined)) quad = refined;
}

}  // namespace dd3
