#include <algorithm>
#include <cmath>

#include "internal.hpp"

namespace dd3 {

Quad order_clockwise(const Quad& q) {
    // Trục y hướng xuống: sắp theo góc quanh trọng tâm, bắt đầu từ điểm trên-trái nhất (x + y nhỏ nhất).
    float cx = 0, cy = 0;
    for (const auto& p : q) { cx += p.x; cy += p.y; }
    cx /= 4; cy /= 4;
    std::array<int, 4> idx = {0, 1, 2, 3};
    std::array<float, 4> ang;
    for (int i = 0; i < 4; ++i) ang[i] = std::atan2(q[i].y - cy, q[i].x - cx);
    std::sort(idx.begin(), idx.end(), [&](int a, int b) { return ang[a] < ang[b]; });
    int start = 0;
    for (int i = 1; i < 4; ++i)
        if (q[idx[i]].x + q[idx[i]].y < q[idx[start]].x + q[idx[start]].y) start = i;
    Quad out;
    for (int i = 0; i < 4; ++i) out[i] = q[idx[(start + i) % 4]];
    return out;
}

double polygon_area(const Quad& q) {
    double s = 0;
    for (int i = 0; i < 4; ++i) {
        const auto& a = q[i];
        const auto& b = q[(i + 1) % 4];
        s += double(a.x) * b.y - double(b.x) * a.y;
    }
    return std::abs(s) / 2;
}

bool is_convex(const Quad& q) {
    int sign = 0;
    for (int i = 0; i < 4; ++i) {
        const auto& p0 = q[i];
        const auto& p1 = q[(i + 1) % 4];
        const auto& p2 = q[(i + 2) % 4];
        double cross = double(p1.x - p0.x) * (p2.y - p1.y) - double(p1.y - p0.y) * (p2.x - p1.x);
        if (cross == 0) return false;
        int s = cross > 0 ? 1 : -1;
        if (sign && s != sign) return false;
        sign = s;
    }
    return true;
}

double angle_diff(double a, double b) {
    double d = std::fmod(std::abs(a - b), CV_PI);
    return std::min(d, CV_PI - d);
}

}  // namespace dd3
