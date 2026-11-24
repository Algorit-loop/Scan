// Chạy pipeline bố cục của app (web/layout.js + onnxruntime-web, 1 luồng như trên điện thoại) trên ảnh JPEG:
// hướng trang (doc_ori) -> xoay nếu cần -> model bố cục -> hậu xử lý. In kết quả + thời gian từng bước.
//   node scripts/check-layout.mjs [--model S|L] [--no-ori] ảnh1.jpg [ảnh2.jpg ...]
// Có file chuẩn cạnh ảnh thì so khớp (cùng nhãn, IoU >= 0.9, chỉ xét vùng điểm >= --min, mặc định 0.5 cho L):
//   <ảnh>.json          kết quả PaddleX cho S (Core/tools/export_layout_onnx.py --paddlex-ref), so chặt (mặc định min 0.3)
//   <ảnh>.L.json        kết quả PaddleX cho L (app lưu trọng số fp16 nên có thể lệch rất nhẹ)
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-web';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const Layout = require('../web/layout.js');

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const model = flag('--model') ?? 'S';
const minArg = flag('--min');
const noOri = args.includes('--no-ori');
const files = args.filter((a) => !a.startsWith('--'));
// App chỉ đóng gói S. L (RT-DETR) không chạy được trong WebView iOS; muốn thử L trên máy tính thì tạo file bằng
// Core/tools/export_layout_extra.py --l rồi chạy --model L.
const FILES = { S: 'pp_doclayout_s.onnx', L: 'pp_doclayout_l_f16w.onnx' };
if (!FILES[model]) throw new Error(`--model phải là ${Object.keys(FILES).join(' | ')}`);

ort.env.wasm.numThreads = 1;
const load = (f) => ort.InferenceSession.create(readFileSync(join(app, 'assets/layout', f)));
const session = await load(FILES[model]);
const ori = noOri ? null : await load('pp_lcnet_doc_ori.onnx');

let failed = 0;
for (const file of files) {
  const t0 = performance.now();
  const dec = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  let img = { data: new Uint8ClampedArray(dec.data.buffer, dec.data.byteOffset, dec.data.length), w: dec.width, h: dec.height };
  const t1 = performance.now();
  let rot = { angle: 0, score: 1, rotate: 0 };
  if (ori) {
    const x = Layout.orientationPreprocess(img.data, img.w, img.h);
    const out = await ori.run({ [ori.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, 224, 224]) });
    rot = Layout.orientation(out[ori.outputNames[0]].data);
    if (rot.rotate) img = Layout.rotateRGBA(img.data, img.w, img.h, rot.rotate);
  }
  const t2 = performance.now();
  const pre = Layout.preprocess(img.data, img.w, img.h, { model });
  const t3 = performance.now();
  const S = pre.side;
  const feeds = {
    image: new ort.Tensor('float32', pre.data, [1, 3, S, S]),
    scale_factor: new ort.Tensor('float32', pre.scale, [1, 2]),
  };
  if (pre.imShape) feeds.im_shape = new ort.Tensor('float32', new Float32Array([S, S]), [1, 2]);
  const out = await session.run(feeds);
  const t4 = performance.now();
  const num = Number(out[session.outputNames[1]].data[0]);
  const regions = Layout.postprocess(out[session.outputNames[0]].data, num, img.w, img.h, { model });
  const t5 = performance.now();

  console.log(`\n${basename(file)} ${img.w}x${img.h} [${model}]: ${regions.length} vùng (>= 0.3)`);
  console.log(
    `  hướng: ảnh xoay ${rot.angle}° (điểm ${rot.score.toFixed(2)}) -> xoay thêm ${rot.rotate}° · ` +
      `giải mã ${(t1 - t0).toFixed(0)} · hướng ${(t2 - t1).toFixed(0)} · tiền xử lý ${(t3 - t2).toFixed(0)} · ` +
      `suy luận ${(t4 - t3).toFixed(0)} · hậu xử lý ${(t5 - t4).toFixed(1)} ms`,
  );
  for (const r of regions) {
    console.log(`  ${String(r.index).padStart(2)} ${r.label.padEnd(17)} ${r.score.toFixed(2)} [${r.box.map((v) => v.toFixed(0)).join(', ')}]`);
  }

  const refPath = file.replace(/\.[^.]+$/, model === 'S' ? '.json' : `.${model}.json`);
  if (!existsSync(refPath)) continue;
  const strict = model === 'S';
  const min = Number(minArg ?? (strict ? 0.3 : 0.5));
  const ref = JSON.parse(readFileSync(refPath, 'utf8')).filter((b) => b.score >= min);
  const mine = regions.filter((r) => r.score >= min);
  const used = new Set();
  let matched = 0;
  let maxScore = 0;
  for (const b of ref) {
    let best = -1;
    let bestIou = 0;
    mine.forEach((r, i) => {
      if (used.has(i) || r.label !== b.label) return;
      const v = Layout.iou(r.box, b.coordinate);
      if (v > bestIou) [best, bestIou] = [i, v];
    });
    if (best >= 0 && bestIou >= 0.9) {
      used.add(best);
      matched++;
      maxScore = Math.max(maxScore, Math.abs(mine[best].score - b.score));
    }
  }
  const ok = matched === ref.length && mine.length === ref.length;
  if (strict && !ok) failed++;
  console.log(
    `  so với PaddleX (${ref.length} vùng >= ${min}): ${ok ? 'KHỚP' : 'LỆCH'} — khớp ${matched}, thiếu ${ref.length - matched}, ` +
      `thừa ${mine.length - matched}, lệch điểm tối đa ${maxScore.toFixed(3)}${strict ? '' : ' (tham khảo: chuẩn là bản fp32)'}`,
  );
}
process.exit(failed ? 1 : 0);
