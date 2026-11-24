// Chạy đúng pipeline OCR của app (web/ocr-prep.js + Tesseract WASM + web/ocr-parse.js) trên ảnh JPEG đã nắn phẳng.
//   node scripts/check-ocr.mjs [--raw] [--show] ảnh1.jpg [ảnh2.jpg ...]
//     --raw   bỏ bước tiền xử lý (để thấy tác dụng của khử bóng / đổi cỡ)
//     --show  in văn bản nhận được
//     --json  ghi <ảnh>.ocr.json = { width, height, lines } (đầu vào của src/reading/compose.ts, dùng làm fixture test)
// Có đáp án cạnh ảnh thì tính sai số: <ảnh>.txt, hoặc <tên>.txt cho ảnh <tên>_<rộng>.jpg (bộ thử sinh bằng
// Core/tools/make_ocr_testset.py). CER = sai ký tự, WER = sai từ (khoảng cách Levenshtein / độ dài đáp án).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const OcrPrep = require('../web/ocr-prep.js');
const OcrParse = require('../web/ocr-parse.js');
const TesseractCore = require('tesseract.js-core/tesseract-core-simd-lstm.js');

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const raw = args.includes('--raw');
const show = args.includes('--show');
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));

const T = await TesseractCore({ wasmBinary: readFileSync(join(app, 'assets/ocr/tesseract-core-simd-lstm.wasm')) });
T.FS.writeFile('/vie.traineddata', readFileSync(join(app, 'assets/ocr/vie.traineddata')));
const api = new T.TessBaseAPI();
if (api.Init('/', 'vie', T.OEM_LSTM_ONLY) !== 0) throw new Error('Tesseract Init lỗi');
api.SetPageSegMode(T.PSM_AUTO);

function lev(a, b) {
  let p = new Int32Array(b.length + 1);
  let c = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) p[j] = j;
  for (let i = 1; i <= a.length; i++) {
    c[0] = i;
    for (let j = 1; j <= b.length; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [p, c] = [c, p];
  }
  return p[b.length];
}
const norm = (s) => s.normalize('NFC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

const sum = { ce: 0, cn: 0, we: 0, wn: 0, ms: 0 };
for (const file of files) {
  const d = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  const t0 = performance.now();
  const pre = raw
    ? { gray: OcrPrep.toGray(d.data, d.width, d.height), w: d.width, h: d.height, scale: 1 }
    : OcrPrep.prepare(d.data, d.width, d.height);
  const t1 = performance.now();
  const ptr = T._malloc(pre.gray.length);
  T.HEAPU8.set(pre.gray, ptr);
  api.SetImage(ptr, pre.w, pre.h, 1, pre.w);
  api.SetSourceResolution(300);
  api.Recognize(null);
  const lines = OcrParse.parseTsv(api.GetTSVText(0), pre.scale);
  T._free(ptr);
  const t2 = performance.now();
  const text = lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n');
  const words = lines.flatMap((l) => l.words);
  const conf = words.length ? words.reduce((s, w) => s + w.conf, 0) / words.length : 0;
  let out = `${basename(file)} ${d.width}x${d.height} -> ${pre.w}x${pre.h}: ${lines.length} dòng, ${words.length} từ, tin cậy ${conf.toFixed(0)} · tiền xử lý ${Math.round(t1 - t0)} · OCR ${Math.round(t2 - t1)} ms`;
  const gtFile = [file.replace(/\.[^.]+$/, '.txt'), file.replace(/_\d+\.[^.]+$/, '.txt')].find((f) => existsSync(f));
  if (gtFile) {
    const g = norm(readFileSync(gtFile, 'utf8'));
    const o = norm(text);
    const ce = lev([...g], [...o]);
    const we = lev(g.split(' '), o.split(' '));
    sum.ce += ce;
    sum.cn += [...g].length;
    sum.we += we;
    sum.wn += g.split(' ').length;
    out += ` · CER ${((100 * ce) / [...g].length).toFixed(2)}% WER ${((100 * we) / g.split(' ').length).toFixed(2)}%`;
  }
  sum.ms += t2 - t0;
  console.log(out);
  if (show) console.log(text + '\n');
  if (json) {
    const round = (b) => b.map((v) => Math.round(v));
    const slim = lines.map((l) => ({ ...l, box: round(l.box), words: l.words.map((w) => ({ text: w.text, conf: Math.round(w.conf), box: round(w.box) })) }));
    writeFileSync(file.replace(/\.[^.]+$/, '.ocr.json'), JSON.stringify({ width: d.width, height: d.height, lines: slim }));
  }
}
if (files.length > 1) {
  console.log(
    `== ${files.length} ảnh, trung bình ${Math.round(sum.ms / files.length)} ms/ảnh` +
      (sum.cn ? `, CER ${((100 * sum.ce) / sum.cn).toFixed(2)}%, WER ${((100 * sum.we) / sum.wn).toFixed(2)}%` : ''),
  );
}
