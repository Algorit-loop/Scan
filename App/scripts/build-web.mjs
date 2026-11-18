// Gói web/ (+ engine wasm nếu đã build) thành một chuỗi HTML cho WebView: src/scanner/page.generated.ts.
// Chạy: npm run build:web  (build-wasm.ps1 tự gọi sau khi build engine).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  '/*@WORKER@*/': jsString(read('web/worker.js')),
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
