// So kết quả docdetect_v3 bản wasm (native/build/docdetect.node.js) với DLL native trên cùng điểm ảnh.
// Chuẩn bị bằng dump_native.py, rồi: node App/native/verify/compare.mjs [thư mục]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, '../../../.tmp/wasm-verify');
const createDocDetect = createRequire(import.meta.url)(join(here, '../build/docdetect.node.js'));
const mod = await createDocDetect();

const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
const out = mod._malloc(15 * 4);
const bySize = {};
const mismatches = [];
let maxDiff = 0;

for (const c of cases) {
  const bytes = readFileSync(join(dir, c.file));
  const p = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, p);
  const t0 = performance.now();
  const status = mod._scan_detect(p, c.w, c.h, out);
  const ms = performance.now() - t0;
  mod._free(p);
  const o = mod.HEAPF32.subarray(out >> 2, (out >> 2) + 15);
  const found = o[0] === 1;
  let diff = 0;
  if (found && c.found) for (let i = 0; i < 8; i++) diff = Math.max(diff, Math.abs(o[3 + i] - c.corners[i]));

  const s = (bySize[c.size] ??= { n: 0, agree: 0, exact: 0, nativeMs: [], wasmMs: [] });
  s.n++;
  s.nativeMs.push(c.ms);
  s.wasmMs.push(ms);
  const agree = status === c.status && found === c.found && (!found || diff < 1e-3);
  if (agree) s.agree++;
  if (agree && diff === 0) s.exact++;
  if (found && c.found) maxDiff = Math.max(maxDiff, diff);
  if (!agree) mismatches.push({ id: c.id, size: c.size, native: c.found, wasm: found, diff, nativeScore: c.score, wasmScore: o[14] });
}

const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [size, s] of Object.entries(bySize)) {
  console.log(
    `${size.padEnd(5)} ${s.agree}/${s.n} khớp (${s.exact} trùng tuyệt đối) · trung vị native ${median(s.nativeMs).toFixed(1)} ms, wasm ${median(s.wasmMs).toFixed(1)} ms`,
  );
}
console.log(`Lệch góc lớn nhất (cả hai cùng thấy): ${maxDiff.toExponential(2)} (đơn vị chuẩn hóa)`);
if (mismatches.length) {
  console.log(`${mismatches.length} ca lệch:`);
  for (const m of mismatches.slice(0, 20)) console.log(' ', JSON.stringify(m));
  process.exitCode = 1;
}
