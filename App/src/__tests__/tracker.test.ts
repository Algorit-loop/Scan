// web/tracker.js là script thường (chạy trong WebView) nhưng có module.exports để test.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Tracker = require('../../web/tracker.js');

const quad = (dx = 0, dy = 0) => [0.2 + dx, 0.2 + dy, 0.8 + dx, 0.2 + dy, 0.8 + dx, 0.8 + dy, 0.2 + dx, 0.8 + dy];

describe('Tracker', () => {
  it('chỉ hiện khung sau khi thấy liên tiếp đủ số lần', () => {
    const t = Tracker.create();
    Tracker.update(t, quad(), 0);
    expect(Tracker.step(t, 16, 16).visible).toBe(false);
    Tracker.update(t, quad(0.005), 60);
    expect(Tracker.step(t, 76, 16).visible).toBe(true);
  });

  it('bỏ qua một lần detect nhảy xa, đi theo khi nhảy được xác nhận', () => {
    const t = Tracker.create();
    Tracker.update(t, quad(), 0);
    Tracker.update(t, quad(), 50);
    Tracker.update(t, quad(0.3), 100); // lẻ tẻ
    expect(Tracker.current(t, 100)![0]).toBeCloseTo(0.2, 5);
    Tracker.update(t, quad(0.3), 150); // xác nhận
    expect(Tracker.current(t, 150)![0]).toBeCloseTo(0.5, 5);
  });

  it('bỏ qua ứng viên sai chỉ lệch hai góc, giữ trạng thái đứng yên', () => {
    const t = Tracker.create();
    for (let now = 0; now <= 800; now += 50) Tracker.update(t, quad(), now);
    const wrong = quad();
    wrong[5] += 0.1; // BR xuống dưới
    wrong[7] += 0.1; // BL xuống dưới
    Tracker.update(t, wrong, 850);
    expect(Tracker.current(t, 850)![5]).toBeCloseTo(0.8, 5);
    Tracker.update(t, quad(), 900);
    expect(Tracker.step(t, 900, 16).steady).toBe(true);
  });

  it('bám theo khi máy lia đều, không trễ xa', () => {
    const t = Tracker.create();
    let now = 0;
    for (let i = 0; i < 40; i++, now += 50) Tracker.update(t, quad(i * 0.005), now);
    // Thật đang ở 0.2 + 39 * 0.005; bản cũ (hệ số bám theo ngưỡng nhảy) trễ > 0,01 ở tốc độ này.
    expect(0.2 + 39 * 0.005 - Tracker.current(t, now - 50)![0]).toBeLessThan(0.006);
  });

  it('làm mượt rung nhỏ', () => {
    const t = Tracker.create();
    Tracker.update(t, quad(), 0);
    Tracker.update(t, quad(), 50);
    Tracker.update(t, quad(0.01), 100);
    const x = Tracker.current(t, 100)![0];
    expect(x).toBeGreaterThan(0.2);
    expect(x).toBeLessThan(0.205);
  });

  it('báo đứng yên sau steadyMs, mất khi rung mạnh', () => {
    const t = Tracker.create();
    for (let now = 0; now <= 800; now += 50) Tracker.update(t, quad(), now);
    expect(Tracker.step(t, 800, 16).steady).toBe(true);
    Tracker.update(t, quad(0.045), 850); // vượt ngưỡng ra 3%, dưới ngưỡng nhảy 5%
    expect(Tracker.step(t, 860, 16).steady).toBe(false);
  });

  it('trôi chậm vẫn bị phát hiện', () => {
    const t = Tracker.create();
    let now = 0;
    for (; now <= 800; now += 50) Tracker.update(t, quad(), now);
    for (let i = 1; i <= 10; i++, now += 50) Tracker.update(t, quad(i * 0.006), now);
    expect(Tracker.step(t, now, 16).steady).toBe(false);
  });

  it('giữ khung một lúc khi mất dấu rồi bỏ', () => {
    const t = Tracker.create();
    Tracker.update(t, quad(), 0);
    Tracker.update(t, quad(), 50);
    Tracker.update(t, null, 100);
    expect(Tracker.step(t, 300, 16).visible).toBe(true);
    expect(Tracker.step(t, 600, 16).visible).toBe(false);
    Tracker.step(t, 800, 16);
    expect(Tracker.current(t, 800)).toBeNull();
  });

  it('tính diện tích', () => {
    expect(Tracker.area(quad())).toBeCloseTo(0.36, 5);
  });
});
