// Kiểm tra dữ liệu người dùng gửi lên. Mỗi hàm trả giá trị đã chuẩn hóa hoặc ném ApiError (thông báo tiếng Việt).

export class ApiError extends Error {
  /** @param {number} status mã HTTP  @param {string} code mã lỗi cho app  @param {string} message hiện cho người dùng */
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const invalid = (field, message) => new ApiError(400, 'INVALID_INPUT', message, field);

export function email(value) {
  if (typeof value !== 'string') throw invalid('email', 'Cần nhập email.');
  const v = value.trim().toLowerCase();
  if (!v) throw invalid('email', 'Cần nhập email.');
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw invalid('email', 'Email không hợp lệ.');
  return v;
}

export function name(value) {
  if (typeof value !== 'string') throw invalid('name', 'Cần nhập tên.');
  const v = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!v) throw invalid('name', 'Cần nhập tên.');
  if (v.length > 60) throw invalid('name', 'Tên dài tối đa 60 ký tự.');
  if (/[\u0000-\u001f<>]/.test(v)) throw invalid('name', 'Tên có ký tự không hợp lệ.');
  return v;
}

/** Mật khẩu mới: 8-128 ký tự. Không ép chữ hoa / ký tự đặc biệt (độ dài quan trọng hơn). */
export function newPassword(value, field = 'password') {
  if (typeof value !== 'string' || !value) throw invalid(field, 'Cần nhập mật khẩu.');
  if (value.length < 8) throw invalid(field, 'Mật khẩu cần ít nhất 8 ký tự.');
  if (value.length > 128) throw invalid(field, 'Mật khẩu dài tối đa 128 ký tự.');
  return value;
}

/** Mật khẩu đang dùng (đăng nhập, xác nhận): chỉ cần có. */
export function password(value, field = 'password') {
  if (typeof value !== 'string' || !value) throw invalid(field, 'Cần nhập mật khẩu.');
  if (value.length > 128) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
  return value;
}
