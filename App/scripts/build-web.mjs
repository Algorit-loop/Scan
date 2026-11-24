// Gói web/ (+ engine wasm nếu đã build) thành một chuỗi HTML cho WebView: src/scanner/page.generated.ts.
// Kèm trang phân vùng bố cục: src/layout/layout.generated.ts (+ chép onnxruntime wasm vào assets/layout/)
// và trang nhận dạng chữ: src/ocr/ocr.generated.ts (+ chép Tesseract wasm vào assets/ocr/).
// Chạy: npm run build:web  (build-wasm.ps1 tự gọi sau khi build engine).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyOrtWasm, copyTesseractWasm } from './copy-ort-wasm.mjs';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(app, p), 'utf8');

/** Chuỗi JS an toàn khi nằm trong thẻ <script>. */
const jsString = (s) => JSON.stringify(s).replace(/<\//g, '<\\/');

function inlineScript(name) {
  const src = read(name);
  if (/<\/script/i.test(src)) throw new Error(`${name} chứa "</script" — không nhúng inline được`);
  return src;
}

const enginePath = join(app, 'native/build/docdetect.js');
const engine = existsSync(enginePath) ? readFileSync(enginePath, 'utf8') : null;

const fill = {
  '/*@ENGINE@*/': engine ? jsString(engine) : 'null',
  '/*@WORKER@*/': jsString(read('web/enhance.js') + '\n' + read('web/worker.js')),
  '/*@TRACKER@*/': inlineScript('web/tracker.js'),
  '/*@PAGE@*/': inlineScript('web/page.js'),
};
let html = read('web/index.html');
for (const [key, value] of Object.entries(fill)) {
  if (!html.includes(key)) throw new Error(`index.html thiếu ${key}`);
  html = html.replace(key, () => value);
}

// Chỉ để lại ASCII: Hermes lưu cả chuỗi dạng UTF-16 nếu có một ký tự ngoài ASCII (gấp đôi dung lượng bundle).
// Ký tự tiếng Việt chỉ nằm trong chuỗi/comment của script nên \uXXXX giữ nguyên nghĩa.
if (/[^\x00-\x7f]/.test(read('web/index.html'))) throw new Error('index.html chỉ được chứa ASCII');
html = html.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const out = join(app, 'src/scanner/page.generated.ts');
writeFileSync(
  out,
  '// File sinh tự động bởi scripts/build-web.mjs từ web/ và native/build — không sửa tay.\n' +
    `export const ENGINE_BUILT = ${engine ? 'true' : 'false'};\n` +
    `export const SCANNER_HTML = ${JSON.stringify(html)};\n`,
);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB, engine: ${engine ? 'có' : 'CHƯA BUILD'})`);

// ---------- Trang phân vùng bố cục (PP-DocLayout, onnxruntime-web) ----------
// Worker (module) = onnxruntime-web ESM (~75 KB, câu export cuối đổi thành `const ort = {...}`) + web/layout.js +
// web/layout-worker.js, nhúng vào trang dạng chuỗi. wasm + model là asset; app ghi trang ra file, trang đọc bằng file://.
const ortPath = join(app, 'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs');
const ortVersion = JSON.parse(read('node_modules/onnxruntime-web/package.json')).version;
function ortModule() {
  const src = readFileSync(ortPath, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '');
  const m = src.match(/export\{([^}]*)\};?\s*$/);
  if (!m) throw new Error('ort.wasm.bundle.min.mjs: không thấy câu export cuối file');
  const names = Object.fromEntries(
    m[1].split(',').map((part) => {
      const [local, exported = local] = part.trim().split(/\s+as\s+/);
      return [exported, local];
    }),
  );
  for (const k of ['InferenceSession', 'Tensor', 'env']) if (!names[k]) throw new Error(`onnxruntime-web không export ${k}`);
  return `${src.slice(0, m.index)}\nconst ort = {InferenceSession:${names.InferenceSession},Tensor:${names.Tensor},env:${names.env}};\n`;
}
let layoutHtml = read('web/layout.html');
const layoutFill = {
  '/*@WORKER@*/': jsString(ortModule() + read('web/layout.js') + '\n' + read('web/layout-worker.js')),
  '/*@LAYOUT_PAGE@*/': inlineScript('web/layout-page.js'),
};
for (const [key, value] of Object.entries(layoutFill)) {
  if (!layoutHtml.includes(key)) throw new Error(`layout.html thiếu ${key}`);
  layoutHtml = layoutHtml.replace(key, () => value);
}
if (/[^\x00-\x7f]/.test(read('web/layout.html'))) throw new Error('layout.html chỉ được chứa ASCII');
layoutHtml = layoutHtml.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const layoutOut = join(app, 'src/layout/layout.generated.ts');
mkdirSync(dirname(layoutOut), { recursive: true });
writeFileSync(
  layoutOut,
  '// File sinh tự động bởi scripts/build-web.mjs từ web/layout*.{html,js} + onnxruntime-web — không sửa tay.\n' +
    `export const ORT_VERSION = ${JSON.stringify(ortVersion)};\n` +
    `export const LAYOUT_HTML = ${JSON.stringify(layoutHtml)};\n`,
);
console.log(`Wrote ${layoutOut} (${(layoutHtml.length / 1024).toFixed(0)} KB, onnxruntime-web ${ortVersion})`);
copyOrtWasm();

// ---------- Trang nhận dạng chữ (Tesseract WebAssembly) ----------
// Worker (script thường) = tesseract.js-core (biến TesseractCore) + web/ocr-prep.js + web/ocr-parse.js +
// web/ocr-worker.js, nhúng vào trang dạng chuỗi. wasm + dữ liệu tiếng Việt là asset; trang đọc bằng file://.
const tessCore = read('node_modules/tesseract.js-core/tesseract-core-simd-lstm.js');
const tessVersion = JSON.parse(read('node_modules/tesseract.js-core/package.json')).version;
let ocrHtml = read('web/ocr.html');
const ocrWorker = [tessCore, read('web/ocr-prep.js'), read('web/ocr-parse.js'), read('web/ocr-worker.js')].join('\n');
const ocrFill = {
  '/*@WORKER@*/': jsString(ocrWorker),
  '/*@OCR_PAGE@*/': inlineScript('web/ocr-page.js'),
};
for (const [key, value] of Object.entries(ocrFill)) {
  if (!ocrHtml.includes(key)) throw new Error(`ocr.html thiếu ${key}`);
  ocrHtml = ocrHtml.replace(key, () => value);
}
if (/[^\x00-\x7f]/.test(read('web/ocr.html'))) throw new Error('ocr.html chỉ được chứa ASCII');
ocrHtml = ocrHtml.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const ocrOut = join(app, 'src/ocr/ocr.generated.ts');
mkdirSync(dirname(ocrOut), { recursive: true });
writeFileSync(
  ocrOut,
  '// File sinh tự động bởi scripts/build-web.mjs từ web/ocr*.{html,js} + tesseract.js-core — không sửa tay.\n' +
    `export const TESSERACT_VERSION = ${JSON.stringify(tessVersion)};\n` +
    `export const OCR_HTML = ${JSON.stringify(ocrHtml)};\n`,
);
console.log(`Wrote ${ocrOut} (${(ocrHtml.length / 1024).toFixed(0)} KB, tesseract.js-core ${tessVersion})`);
copyTesseractWasm();
