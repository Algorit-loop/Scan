/** Tên tiếng Việt + màu khung cho mọi lớp của các model bố cục (danh sách lớp: MODELS trong web/layout.js). */
export const LAYOUT_LABELS: Record<string, { vi: string; color: string }> = {
  doc_title: { vi: 'Tiêu đề tài liệu', color: '#FF4D4D' },
  paragraph_title: { vi: 'Tiêu đề đoạn', color: '#FF9F1A' },
  text: { vi: 'Văn bản', color: '#3DA5FF' },
  abstract: { vi: 'Tóm tắt', color: '#5CC8FF' },
  content: { vi: 'Mục lục', color: '#7AD7F0' },
  reference: { vi: 'Tài liệu tham khảo', color: '#8FB3FF' },
  aside_text: { vi: 'Chữ bên lề', color: '#A0A0FF' },
  footnote: { vi: 'Chú thích cuối trang', color: '#B98CFF' },
  table: { vi: 'Bảng', color: '#27E36B' },
  table_title: { vi: 'Tiêu đề bảng', color: '#9BEA5B' },
  image: { vi: 'Hình ảnh', color: '#FF5AD2' },
  figure_title: { vi: 'Chú thích hình', color: '#FF8AE0' },
  chart: { vi: 'Biểu đồ', color: '#E05AFF' },
  chart_title: { vi: 'Tiêu đề biểu đồ', color: '#EA9BFF' },
  formula: { vi: 'Công thức', color: '#1DE9B6' },
  formula_number: { vi: 'Số công thức', color: '#64FFDA' },
  algorithm: { vi: 'Thuật toán', color: '#00BFA5' },
  number: { vi: 'Số trang', color: '#FFD400' },
  header: { vi: 'Đầu trang', color: '#BDBDBD' },
  header_image: { vi: 'Ảnh đầu trang', color: '#D7CCC8' },
  footer: { vi: 'Chân trang', color: '#9E9E9E' },
  footer_image: { vi: 'Ảnh chân trang', color: '#BCAAA4' },
  seal: { vi: 'Con dấu', color: '#FF6E40' },
};

export function labelInfo(label: string) {
  return LAYOUT_LABELS[label] ?? { vi: label, color: '#FFFFFF' };
}
