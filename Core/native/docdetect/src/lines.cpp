// Gộp các đoạn LSD thẳng hàng thành đường dài (chịu được mép bị ngắt quãng / che một phần).
#include <algorithm>
#include <cmath>
#include <numeric>

#include "internal.hpp"

namespace dd {

double Line::overlap(const cv::Point2d& a, const cv::Point2d& b) const {
    double ta = (a - p).dot(d), tb = (b - p).dot(d);
    double lo = std::min(ta, tb), hi = std::max(ta, tb);
    double s = 0;
    for (const auto& [s0, e0] : iv) s += std::max(0.0, std::min(hi, e0) - std::max(lo, s0));
    return s;
}

namespace {

// Tổng có trọng số (độ dài) của các đầu mút trong một cụm, để khớp lại đường sau mỗi lần thêm đoạn.
struct Cluster {
    double sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    double theta = 0, nx = 0, ny = 1, c = 0;
    std::vector<int> members;

    void add(double x, double y, double w) {
        sw += w; sx += w * x; sy += w * y;
        sxx += w * x * x; sxy += w * x * y; syy += w * y * y;
    }
    void fit() {
        double mx = sx / sw, my = sy / sw;
        double vxx = sxx / sw - mx * mx, vxy = sxy / sw - mx * my, vyy = syy / sw - my * my;
        theta = 0.5 * std::atan2(2 * vxy, vxx - vyy);
        nx = -std::sin(theta); ny = std::cos(theta);
        c = nx * mx + ny * my;
    }
};

}  // namespace

std::vector<Line> merge_segments(const std::vector<cv::Vec4f>& segs, int w, int h, const dd_params& P) {
    const double side = std::max(w, h);
    struct Seg { cv::Point2d a, b; double len; };
    std::vector<Seg> s;
    s.reserve(segs.size());
    for (const auto& v : segs) {
        cv::Point2d a(v[0], v[1]), b(v[2], v[3]);
        double len = cv::norm(b - a);
        if (len >= P.min_segment * side) s.push_back({a, b, len});
    }
    std::sort(s.begin(), s.end(), [](const Seg& x, const Seg& y) { return x.len > y.len; });

    std::vector<Cluster> cl;
    cl.reserve(s.size());
    for (int i = 0; i < (int)s.size(); ++i) {
        const auto& g = s[i];
        double ang = std::atan2(g.b.y - g.a.y, g.b.x - g.a.x);
        int j = -1;
        for (int k = 0; k < (int)cl.size(); ++k) {
            const auto& c = cl[k];
            double dth = std::fmod(std::abs(ang - c.theta), CV_PI);
            dth = std::min(dth, CV_PI - dth);
            if (dth > P.merge_angle) continue;
            double da = std::abs(c.nx * g.a.x + c.ny * g.a.y - c.c);
            double db = std::abs(c.nx * g.b.x + c.ny * g.b.y - c.c);
            if (std::max(da, db) <= P.merge_dist) { j = k; break; }
        }
        if (j < 0) { j = (int)cl.size(); cl.emplace_back(); }
        cl[j].members.push_back(i);
        cl[j].add(g.a.x, g.a.y, g.len);
        cl[j].add(g.b.x, g.b.y, g.len);
        cl[j].fit();
    }

    std::vector<Line> lines;
    for (const auto& c : cl) {
        Line ln;
        ln.p = {c.sx / c.sw, c.sy / c.sw};
        ln.d = {c.ny, -c.nx};
        ln.n = {c.nx, c.ny};
        ln.c = c.c;
        std::vector<std::pair<double, double>> ts;
        for (int i : c.members) {
            double t0 = (s[i].a - ln.p).dot(ln.d), t1 = (s[i].b - ln.p).dot(ln.d);
            ts.emplace_back(std::min(t0, t1), std::max(t0, t1));
        }
        std::sort(ts.begin(), ts.end());
        for (const auto& t : ts) {
            if (!ln.iv.empty() && t.first <= ln.iv.back().second)
                ln.iv.back().second = std::max(ln.iv.back().second, t.second);
            else
                ln.iv.push_back(t);
        }
        for (const auto& [a, b] : ln.iv) ln.covered += b - a;
        if (ln.covered < P.min_line_cover * side) continue;
        double a = std::atan2(ln.d.y, ln.d.x);
        ln.angle = a < 0 ? a + CV_PI : (a >= CV_PI ? a - CV_PI : a);
        lines.push_back(std::move(ln));
    }
    std::sort(lines.begin(), lines.end(), [](const Line& a, const Line& b) { return a.covered > b.covered; });
    if ((int)lines.size() > P.max_lines) lines.resize(P.max_lines);
    return lines;
}

}  // namespace dd
