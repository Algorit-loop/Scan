import type { Instruction } from './computeGuidance';

export const INSTRUCTION_TEXT: Record<Instruction, string> = {
  notFound: 'Không thấy tài liệu. Hãy giữ điện thoại cao hơn, ngay phía trên tài liệu',
  lowContrast: 'Khó nhìn thấy tài liệu. Hãy đặt tài liệu lên nền tối màu hơn',
  left: 'Di chuyển sang trái',
  right: 'Di chuyển sang phải',
  up: 'Di chuyển lên trên',
  down: 'Di chuyển xuống dưới',
  closer: 'Đưa điện thoại lại gần hơn',
  farther: 'Đưa điện thoại ra xa hơn',
  hold: 'Giữ yên',
};

export const MESSAGES = {
  scanStart: 'Bắt đầu quét. Hãy hướng camera xuống tài liệu',
  aligned: 'Đã căn chỉnh xong. Chạm vào màn hình bất kỳ đâu để chụp',
  capturing: 'Đang chụp, giữ yên',
  saved: 'Đã lưu tài liệu',
  saveFailed: 'Chụp không thành công, hãy thử lại',
  manualHint: 'Nếu khó căn chỉnh, bạn có thể chạm vào màn hình để chụp luôn',
  permissionExplain:
    'Ứng dụng cần quyền camera để quét tài liệu. Hãy chạm nút Cho phép camera ở giữa màn hình',
  serverLost: 'Mất kết nối máy chủ, chuyển sang chế độ ngoại tuyến',
  serverBack: 'Đã kết nối lại máy chủ',
  fallbackNativeCamera: 'Chuyển sang chế độ chụp ảnh, hướng dẫn sẽ chậm hơn',
  noVietnameseVoice:'Máy chưa có giọng đọc tiếng Việt. Hãy cài giọng tiếng Việt trong cài đặt',
} as const;
