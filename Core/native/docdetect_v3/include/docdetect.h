/*
 * docdetect_v3 — tìm 4 góc tài liệu trong ảnh (clone v2, cải thiện bằng C++).
 *
 * Chỉ phụ thuộc OpenCV core + imgproc (có sẵn bản build cho Android/iOS), nên cùng mã nguồn dùng được cho:
 *   - server (Python gọi qua ctypes: Core/detect/v3),
 *   - Android (JNI) và iOS (Objective-C++) sau này.
 *
 * API dạng C để gọi được từ mọi ngôn ngữ. Không cấp phát bộ nhớ cho người gọi, không giữ trạng thái toàn cục
 * (trừ số luồng OpenCV), an toàn khi gọi từ nhiều luồng với các ảnh khác nhau.
 */
#ifndef DOCDETECT_V3_H
#define DOCDETECT_V3_H

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#  define DD3_API __declspec(dllexport)
#else
#  define DD3_API __attribute__((visibility("default")))
#endif

#define DD3_MAX_LINES 32

/* Định dạng điểm ảnh của bộ đệm đầu vào. */
enum dd3_format { DD3_GRAY = 1, DD3_BGR = 3, DD3_BGRA = 4, DD3_RGBA = 5 };

/* Lý do không tìm thấy. */
enum dd3_reason { DD3_FOUND = 0, DD3_NONE = 1, DD3_LOW_CONTRAST = 2 };

/* Nguồn của tứ giác được chọn. */
enum dd3_method { DD3_LINES = 0, DD3_COLOR = 1, DD3_BRIGHT = 2, DD3_DARK = 3, DD3_EDGES = 4 };

/*
 * Tham số. Đơn vị pixel tính trên ảnh làm việc (cạnh dài = work_side). Gọi dd3_default_params() rồi sửa nếu cần.
 */
typedef struct dd3_params {
    int   work_side;           /* thu nhỏ ảnh về cạnh dài này (không phóng to ảnh nhỏ hơn) */
    float low_contrast_std;    /* độ lệch chuẩn mức xám dưới mức này: ảnh phẳng, dừng */
    int   close_kernel;        /* đóng hình thái để xóa chữ trong trang */
    int   close_iterations;
    float min_segment;         /* đoạn LSD ngắn nhất, theo cạnh dài */
    float merge_angle;         /* rad: gộp đoạn cùng hướng */
    float merge_dist;          /* px: gộp đoạn cùng đường */
    float min_line_cover;      /* độ dài phủ tối thiểu của một đường, theo cạnh dài */
    int   max_lines;
    float parallel_tol;        /* rad: hai cạnh đối coi là song song */
    float min_corner_angle_sin;
    float min_side_separation; /* theo cạnh dài */
    float min_area_ratio;
    float corner_margin;       /* góc được nằm ngoài ảnh tối đa chừng này (theo kích thước ảnh) */
    int   prescore_keep;       /* số ứng viên từ đường thẳng giữ lại để chấm đầy đủ */
    int   use_regions;         /* 1: thêm ứng viên từ phân vùng màu / sáng / tối */
    float grad_sigma;          /* làm mờ trước Sobel */
    float lab_sigma;           /* làm mờ ảnh Lab để đo tương phản */
    float sample_step;         /* px: bước lấy mẫu dọc cạnh */
    float side_trim;           /* bỏ phần này ở hai đầu mỗi cạnh */
    int   edge_window;         /* px: tìm biên trong ±edge_window theo pháp tuyến */
    float contrast_offset;     /* px: lấy màu cách cạnh bao nhiêu */
    float contrast_full;       /* khoảng cách màu Lab coi là đủ tương phản */
    float border_credit;       /* điểm cho cạnh nằm sát mép ảnh */
    float border_touch_px;
    float min_score;           /* dưới mức này: không thấy tài liệu */
    float confidence_full;     /* điểm từ mức này trở lên: độ tin cậy = 1 */
    /* Vùng cần xét (pixel của ảnh vào), vd. bỏ dải viền letterbox. roi_w hoặc roi_h = 0: cả ảnh.
       Góc trả về vẫn chuẩn hóa theo cả ảnh vào. */
    int   roi_x, roi_y, roi_w, roi_h;
} dd3_params;

typedef struct dd3_point { float x, y; } dd3_point;

typedef struct dd3_result {
    int      found;            /* 1 nếu tìm thấy */
    int      reason;           /* dd3_reason */
    int      method;           /* dd3_method (khi found) */
    dd3_point corners[4];       /* TL, TR, BR, BL — chuẩn hóa 0..1 theo ảnh đầu vào */
    float    confidence;       /* 0..1 */
    float    score;            /* điểm tốt nhất (kể cả khi dưới ngưỡng) */
    float    coverage[4];      /* chi tiết điểm từng cạnh (trên, phải, dưới, trái) */
    float    contrast[4];
    float    consistency;
    float    area;             /* diện tích tứ giác / diện tích ảnh */
    float    sharpness;        /* phương sai Laplacian (đo độ nét) */
    int      candidates;       /* số ứng viên đã chấm */
    int      n_lines;          /* số đường tìm được (tối đa DD3_MAX_LINES được trả về) */
    float    lines[DD3_MAX_LINES][4]; /* x0, y0, x1, y1 chuẩn hóa — để vẽ debug */
    int      work_width, work_height;
    float    ms_prep, ms_lines, ms_quads, ms_total; /* thời gian từng bước */
} dd3_result;

DD3_API const char* dd3_version(void);
DD3_API void dd3_default_params(dd3_params* params);

/*
 * Detect trên một bộ đệm ảnh.
 *   data   : điểm ảnh, hàng đầu tiên là hàng trên cùng
 *   stride : số byte mỗi hàng (0 = width * số kênh)
 *   params : NULL = mặc định
 * Trả 0 nếu chạy được (kể cả khi không thấy tài liệu), số âm nếu tham số sai.
 */
DD3_API int dd3_detect(const unsigned char* data, int width, int height, int stride, int format,
                     const dd3_params* params, dd3_result* out);

/* Số luồng OpenCV dùng bên trong (0 = tắt đa luồng, -1 = mặc định). Trên mobile nên để 1–2. */
DD3_API void dd3_set_num_threads(int n);

#ifdef __cplusplus
}
#endif
#endif
