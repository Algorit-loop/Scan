// Kiểu dữ liệu dùng chung giữa các bước. Thuật toán giống detect v1 (Python), viết lại cho nhanh.
#pragma once

#include <array>
#include <utility>
#include <vector>

#include <opencv2/core.hpp>

#include "docdetect.h"

namespace dd3 {

using Quad = std::array<cv::Point2f, 4>;

// Một đường thẳng dài, gộp từ nhiều đoạn LSD thẳng hàng.
struct Line {
    cv::Point2d p;      // một điểm trên đường (trọng tâm)
    cv::Point2d d;      // hướng đơn vị
    cv::Point2d n;      // pháp tuyến đơn vị
    double c = 0;       // n·x = c
    double angle = 0;   // hướng trong [0, π)
    std::vector<std::pair<double, double>> iv;  // các khoảng tham số t dọc d thực sự có cạnh
    double covered = 0; // tổng độ dài các khoảng

    // Độ dài phần cạnh a→b (nằm trên đường này) được các đoạn thật phủ lên.
    double overlap(const cv::Point2d& a, const cv::Point2d& b) const;
};

struct Candidate {
    Quad quad;          // theo chiều kim đồng hồ, bắt đầu từ trên-trái
    int source = DD3_LINES;
    float prescore = 0;
    float score = 0;
    float coverage[4] = {0, 0, 0, 0};
    float contrast[4] = {0, 0, 0, 0};
    float consistency = 1;
    float area = 0;
};

// Ảnh đã chuẩn bị sẵn cho bước chấm điểm.
struct ScoreContext {
    cv::Mat gx, gy;     // CV_32F, gradient
    cv::Mat lab;        // CV_32FC3, Lab đã làm mờ
    float edge_thresh = 4;
    int w = 0, h = 0;
};

// geometry.cpp
Quad order_clockwise(const Quad& q);
double polygon_area(const Quad& q);
bool is_convex(const Quad& q);
double angle_diff(double a, double b);

// lines.cpp
std::vector<Line> merge_segments(const std::vector<cv::Vec4f>& segs, int w, int h, const dd3_params& P);

// quads.cpp
std::vector<Candidate> from_lines(const std::vector<Line>& lines, int w, int h, const dd3_params& P);
std::vector<Candidate> from_regions(const cv::Mat& lab8, const cv::Mat& gray, const dd3_params& P);
std::vector<Candidate> from_edges(const cv::Mat& gray, const dd3_params& P);
void refine_quad(Quad& quad, const cv::Mat& gray);

// scoring.cpp
ScoreContext build_context(const cv::Mat& smooth_gray, const cv::Mat& lab8, const dd3_params& P);
void score_quad(Candidate& c, const ScoreContext& ctx, const dd3_params& P);

}  // namespace dd3
