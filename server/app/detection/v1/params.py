"""Hằng số của detect v1. Mọi đơn vị pixel tính trên ảnh đã thu nhỏ (cạnh dài = WORK_SIDE)."""

WORK_SIDE = 640
LOW_CONTRAST_STD = 8.0

# Xóa nội dung bên trong trang trước khi tìm cạnh (tài liệu mục 4.1: close 5x5, lặp 3 lần).
CLOSE_KERNEL = 5
CLOSE_ITERATIONS = 3

# Gộp đoạn thẳng LSD thành đường.
MIN_SEGMENT = 0.02            # độ dài đoạn tối thiểu, theo cạnh dài của ảnh
MERGE_ANGLE = 0.07            # rad (~4°)
MERGE_DIST = 3.0              # px
MIN_LINE_COVER = 0.07         # độ dài phủ tối thiểu của một đường, theo cạnh dài — bỏ chi tiết ngắn như vòng gáy xoắn
MAX_LINES = 24

# Sinh tứ giác từ đường.
PARALLEL_TOL = 0.55           # rad (~31°): hai cạnh đối được coi là song song (cho phép phối cảnh)
MIN_CORNER_ANGLE_SIN = 0.77   # góc giữa hai họ cạnh trong khoảng ~50°..130°
MIN_SIDE_SEPARATION = 0.08    # khoảng cách tối thiểu giữa hai cạnh đối, theo cạnh dài
MIN_AREA_RATIO = 0.04
CORNER_MARGIN = 0.05          # cho phép góc nằm ngoài ảnh tối đa chừng này
PRESCORE_KEEP = 30            # số ứng viên giữ lại để chấm điểm đầy đủ

# Chấm điểm.
SAMPLE_STEP = 3.0
SIDE_TRIM = 0.06              # bỏ 6% hai đầu mỗi cạnh khi lấy mẫu (quanh góc)
EDGE_WINDOW = 3               # px: tìm cạnh trong ±EDGE_WINDOW theo pháp tuyến
CONTRAST_OFFSET = 5.0         # px: lấy màu cách cạnh bao nhiêu để so trong/ngoài
CONTRAST_FULL = 22.0          # khoảng cách màu Lab coi là tương phản "đủ"
BORDER_CREDIT = 0.45          # cạnh nằm sát mép ảnh: giả định là mép tài liệu, cho điểm chừng này
BORDER_TOUCH_PX = 6

MIN_SCORE = 0.30              # dưới mức này: không thấy tài liệu
GRABCUT_TRIGGER = 0.50        # tốt nhất chưa tới mức này thì thử thêm GrabCut
GRABCUT_SIDE = 224
GRABCUT_ITERATIONS = 3
