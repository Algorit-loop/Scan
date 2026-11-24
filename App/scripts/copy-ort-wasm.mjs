// Chép onnxruntime-web wasm (đúng phiên bản trong node_modules) vào assets/layout/ để Metro phục vụ như asset.
// File 14 MB nên không commit (.gitignore); chạy tự động khi npm install (postinstall) và khi build:web.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(app, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm');
const dst = join(app, 'assets/layout/ort-wasm-simd-threaded.wasm');

export function copyOrtWasm() {
  if (!existsSync(src)) {
    console.warn('copy-ort-wasm: chưa cài onnxruntime-web, bỏ qua');
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(dst) && statSync(dst).size === statSync(src).size && statSync(dst).mtimeMs >= statSync(src).mtimeMs) return;
  copyFileSync(src, dst);
  console.log(`Copied ${dst}`);
}

/** Tesseract (LSTM + SIMD) wasm cho trang nhận dạng chữ -> assets/ocr/ (3 MB, không commit). */
export function copyTesseractWasm() {
  const from = join(app, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm');
  const to = join(app, 'assets/ocr/tesseract-core-simd-lstm.wasm');
  if (!existsSync(from)) {
    console.warn('copy-ort-wasm: chưa cài tesseract.js-core, bỏ qua');
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size && statSync(to).mtimeMs >= statSync(from).mtimeMs) return;
  copyFileSync(from, to);
  console.log(`Copied ${to}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  copyOrtWasm();
  copyTesseractWasm();
}
