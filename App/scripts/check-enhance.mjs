// Chạy bộ lọc "Rõ chữ" (web/enhance.js) trên ảnh JPEG, ghi <ảnh>.enhanced.jpg cạnh ảnh để xem bằng mắt + in thời gian.
//   node scripts/check-enhance.mjs ảnh1.jpg [ảnh2.jpg ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const Enhance = require('../web/enhance.js');

for (const file of process.argv.slice(2)) {
  const img = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
  const t0 = performance.now();
  const out = Enhance.documentEnhance(img.data, img.width, img.height);
  const ms = performance.now() - t0;
  const dst = file.replace(/\.[^.]+$/, '.enhanced.jpg');
  writeFileSync(dst, jpeg.encode({ data: out, width: img.width, height: img.height }, 92).data);
  console.log(`${basename(file)} ${img.width}x${img.height}: ${ms.toFixed(0)} ms -> ${dst}`);
}
