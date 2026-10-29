/** Ảnh xám 8-bit, mỗi pixel 1 byte, hàng nối tiếp hàng. */
export type GrayImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

/** Hình chữ nhật chuẩn hóa về khoảng 0..1 theo kích thước ảnh. */
export type NormRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type NormPoint = { x: number; y: number };

export type EdgeTouches = {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
};

export type DetectionResult =
  | {
      found: true;
      bbox: NormRect;
      /** 4 góc ước lượng: trên-trái, trên-phải, dưới-phải, dưới-trái. */
      corners: [NormPoint, NormPoint, NormPoint, NormPoint];
      /** Diện tích bbox / diện tích khung hình. */
      areaRatio: number;
      touches: EdgeTouches;
      /** 0..1 — độ tin cậy gộp từ độ tương phản và độ "đặc" của vùng. */
      confidence: number;
    }
  | {
      found: false;
      reason: 'none' | 'lowContrast';
    };
