"""Sinh bộ trang tiếng Việt có đáp án để đo OCR của app (App/scripts/check-ocr.mjs).

Mỗi trang: tiêu đề + các đoạn văn (một cột hoặc hai cột), dựng bằng phông Times / Arial của Windows ở cỡ A4 300 dpi,
rồi làm xấu như ảnh chụp đã nắn phẳng: bóng đổ / sáng không đều, xoay lệch 0,6 độ, thu nhỏ về các bề rộng
700 / 1000 / 1350 / 1800 px (ứng với trang giấy chụp bằng luồng camera 1080p ... 4K), mờ nhẹ, nhiễu, nén JPEG.

Ra .tmp/ocr-testset/<tên>_<rộng>.jpg + <tên>.txt (các đoạn theo đúng thứ tự đọc).
Chạy (từ Core/, cần Pillow + opencv: dùng .tools/paddle-venv):
    ..\.tools\paddle-venv\Scripts\python.exe -m tools.make_ocr_testset
    cd ..\App; npm run check:ocr -- ..\.tmp\ocr-testset\*_1350.jpg
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / ".tmp" / "ocr-testset"
OUT.mkdir(parents=True, exist_ok=True)
F = "C:/Windows/Fonts/"
T = {
 "thongbao": dict(font="times", title="THÔNG BÁO", sub="Về việc tổ chức họp phụ huynh học sinh cuối học kỳ I, năm học 2026 – 2027", cols=1, paras=[
  "Kính gửi: Quý phụ huynh học sinh khối lớp 9, Trường Trung học cơ sở Nguyễn Du.",
  "Căn cứ kế hoạch năm học của nhà trường, Ban Giám hiệu trân trọng kính mời quý phụ huynh đến dự buổi họp phụ huynh cuối học kỳ I. Buổi họp sẽ diễn ra vào lúc 7 giờ 30 phút, sáng Chủ nhật, ngày 17 tháng 1 năm 2027, tại phòng học của từng lớp.",
  "Nội dung buổi họp gồm: thông báo kết quả học tập và rèn luyện của học sinh; trao đổi về kế hoạch ôn thi vào lớp 10; thống nhất các khoản thu, chi của quỹ lớp. Giáo viên chủ nhiệm sẽ gửi phiếu điểm cho từng gia đình ngay tại buổi họp.",
  "Để buổi họp đạt kết quả tốt, nhà trường đề nghị quý phụ huynh sắp xếp thời gian, đến đúng giờ. Trường hợp bận việc đột xuất, xin vui lòng liên hệ giáo viên chủ nhiệm trước ngày 15/01/2027 qua số điện thoại 028.3812.4567.",
  "Trân trọng cảm ơn sự quan tâm và phối hợp của quý phụ huynh!"]),
 "suckhoe": dict(font="arial", title="Hướng dẫn sử dụng thuốc hạ sốt cho trẻ em", sub=None, cols=1, paras=[
  "Sốt là phản ứng tự nhiên của cơ thể khi bị nhiễm trùng. Khi trẻ sốt từ 38,5 độ C trở lên, cha mẹ có thể cho trẻ uống thuốc hạ sốt theo đúng liều lượng được ghi trên nhãn hoặc theo chỉ dẫn của bác sĩ.",
  "Liều dùng thông thường là 10 đến 15 mg cho mỗi kg cân nặng, mỗi lần uống cách nhau ít nhất 4 đến 6 giờ. Không dùng quá 5 lần trong vòng 24 giờ. Ví dụ: trẻ nặng 12 kg thì mỗi lần uống từ 120 mg đến 180 mg.",
  "Cần đưa trẻ đến cơ sở y tế ngay nếu trẻ sốt cao liên tục trên 39,5 độ C, co giật, khó thở, nôn nhiều, bỏ bú hoặc lừ đừ, khó đánh thức. Tuyệt đối không tự ý dùng kháng sinh khi chưa có chỉ định.",
  "Bảo quản thuốc ở nơi khô ráo, thoáng mát, tránh ánh nắng trực tiếp và để xa tầm tay trẻ em. Hạn sử dụng: 36 tháng kể từ ngày sản xuất."]),
 "baochi": dict(font="times", title="Mùa gặt trên những thửa ruộng bậc thang", sub=None, cols=2, paras=[
  "Tháng mười, khi sương sớm còn giăng kín các sườn núi, bà con vùng cao đã ra đồng. Những thửa ruộng bậc thang chín vàng nối nhau chạy dài từ chân đồi lên tận đỉnh, trông xa như những bậc thềm khổng lồ dẫn lên trời.",
  "Ông Giàng A Sử, năm nay đã ngoài bảy mươi tuổi, vẫn cùng con cháu gặt lúa. Ông kể rằng ngày xưa phải mất nhiều đời người mới đắp xong một cánh ruộng. “Đất ở đây khó lắm, nhưng lúa thì thơm và dẻo hơn nơi khác”, ông nói.",
  "Năm nay thời tiết thuận lợi, năng suất ước đạt gần 5 tấn mỗi héc-ta, cao hơn năm ngoái khoảng 8%. Nhiều gia đình còn đón khách du lịch đến tham quan, chụp ảnh và trải nghiệm gặt lúa cùng người dân.",
  "Chính quyền xã cho biết sẽ tiếp tục hỗ trợ giống mới, sửa chữa kênh mương và mở thêm các lớp hướng dẫn làm du lịch cộng đồng. Bà con hy vọng mùa gặt không chỉ mang lại những bữa cơm no, mà còn giúp con em có điều kiện đến trường đầy đủ hơn.",
  "Chiều xuống, tiếng cười nói vang khắp bản. Những gùi lúa nặng trĩu theo chân người về nhà, khép lại một ngày lao động vất vả nhưng tràn đầy niềm vui."]),
}
def font(name, size, bold=False):
    f = {"times": ("timesbd.ttf" if bold else "times.ttf"), "arial": ("arialbd.ttf" if bold else "arial.ttf")}[name]
    return ImageFont.truetype(F + f, size)
def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for w in text.split(" "):
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= width: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines
def render(name, spec, W=2480, H=3508):
    img = Image.new("RGB", (W, H), (252, 252, 250)); d = ImageDraw.Draw(img)
    m = 240; y = 260; body = font(spec["font"], 46); lh = 68
    tf = font(spec["font"], 76, True)
    for ln in wrap(d, spec["title"], tf, W - 2 * m):
        d.text(((W - d.textlength(ln, font=tf)) / 2, y), ln, font=tf, fill=(20, 20, 20)); y += 104
    y += 20
    if spec["sub"]:
        sf = font(spec["font"], 50, True)
        for ln in wrap(d, spec["sub"], sf, W - 2 * m - 200):
            d.text(((W - d.textlength(ln, font=sf)) / 2, y), ln, font=sf, fill=(20, 20, 20)); y += 72
        y += 40
    y += 40
    if spec["cols"] == 1:
        for p in spec["paras"]:
            for i, ln in enumerate(wrap(d, p, body, W - 2 * m - (60 if False else 0))):
                d.text((m, y), ln, font=body, fill=(25, 25, 25)); y += lh
            y += 40
    else:
        gap = 110; cw = (W - 2 * m - gap) // 2
        blocks = [(p, wrap(d, p, body, cw)) for p in spec["paras"]]
        total = sum(len(b[1]) * lh + 40 for b in blocks); half = total / 2
        x, yy, used, y0 = m, y, 0, y
        for p, lines in blocks:
            if x == m and used + len(lines) * lh / 2 > half: x, yy = m + cw + gap, y0
            for ln in lines: d.text((x, yy), ln, font=body, fill=(25, 25, 25)); yy += lh
            yy += 40; used += len(lines) * lh + 40
    return np.array(img)[:, :, ::-1].copy()
def degrade(bgr, width, seed):
    rng = np.random.default_rng(seed)
    h, w = bgr.shape[:2]
    # bóng đổ + ánh sáng không đều
    gx = np.linspace(0.78, 1.0, w)[None, :] * np.linspace(1.0, 0.86, h)[:, None]
    out = (bgr.astype(np.float32) * gx[..., None] * np.array([0.97, 0.99, 1.0]))
    # phối cảnh rất nhẹ còn sót sau khi nắn + xoay 0.6 độ
    M = cv2.getRotationMatrix2D((w / 2, h / 2), 0.6, 1.0)
    out = cv2.warpAffine(out, M, (w, h), borderValue=(235, 235, 235))
    nh = round(h * width / w)
    out = cv2.resize(out, (width, nh), interpolation=cv2.INTER_AREA)
    out = cv2.GaussianBlur(out, (0, 0), 0.7)
    out += rng.normal(0, 3.0, out.shape)
    return np.clip(out, 0, 255).astype(np.uint8)
for i, (name, spec) in enumerate(T.items()):
    page = render(name, spec)
    paras = [spec["title"]] + ([spec["sub"]] if spec["sub"] else []) + spec["paras"]
    (OUT / f"{name}.txt").write_text("\n".join(paras), encoding="utf8")
    for width in (700, 1000, 1350, 1800):
        cv2.imwrite(str(OUT / f"{name}_{width}.jpg"), degrade(page, width, i), [cv2.IMWRITE_JPEG_QUALITY, 90])
print("xong", sorted(p.name for p in OUT.iterdir()))
