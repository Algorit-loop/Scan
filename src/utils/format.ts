const pad = (n: number) => String(n).padStart(2, '0');

/** "14:05, 29/10/2026" — tự định dạng để không phụ thuộc dữ liệu Intl của engine JS. */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Cách đọc tự nhiên cho trình đọc màn hình: "14 giờ 05 phút, ngày 29 tháng 10 năm 2026". */
export function spokenDateTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()} giờ ${pad(d.getMinutes())} phút, ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
}
