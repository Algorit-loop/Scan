/**
 * Từ kết quả OCR (các dòng chữ có tọa độ) -> nội dung để đọc: đoạn văn -> câu.
 *
 *  1. Lọc rác: từ / dòng có độ tin cậy thấp hoặc không chứa chữ, số (vệt bẩn, viền ảnh, hình vẽ bị đọc thành ký tự).
 *  2. Ghép dòng thành đoạn: theo khối + đoạn của Tesseract, rồi nối các đoạn bị tách nhầm (dòng trước chưa hết câu,
 *     khoảng cách dòng bình thường, cỡ chữ như nhau).
 *  3. Tách câu trong từng đoạn (xem `endsSentence`): dấu . ! ? … kết thúc câu trừ khi là viết tắt (TP., ThS., v.v.),
 *     số thứ tự đầu mục (1., a., II.), số thập phân / số điện thoại, hoặc chữ sau đó viết thường.
 *     Đoạn không có dấu kết câu (tiêu đề, đề mục) là một câu. Câu quá dài được chia ở dấu ; : , để dễ nghe và dễ
 *     tua lại.
 *
 * Mỗi câu giữ các khung (theo từng dòng) để tô sáng trên ảnh. Thuần TS, không phụ thuộc React Native: test bằng Jest.
 */

export type Box = [number, number, number, number];
export type OcrWord = { text: string; conf: number; box: Box };
export type OcrLine = { block: number; par: number; line: number; box: Box; words: OcrWord[] };

export type Sentence = {
  /** Thứ tự đọc, từ 0. */
  index: number;
  /** Đoạn chứa câu (chỉ số trong `paragraphs`). */
  paragraph: number;
  text: string;
  /** Khung chữ của câu, mỗi dòng một khung, theo pixel ảnh. */
  boxes: Box[];
  /** Độ tin cậy trung bình của các từ (0..100). */
  conf: number;
};
export type Paragraph = { index: number; text: string; box: Box; sentences: number[] };
export type ReadingDoc = { width: number; height: number; paragraphs: Paragraph[]; sentences: Sentence[]; conf: number };

export const COMPOSE = {
  /** Từ dưới mức này bị bỏ (Tesseract: chữ thật thường > 60, rác thường < 40). */
  minWordConf: 30,
  /** Dòng có độ tin cậy trung bình dưới mức này bị bỏ cả dòng. */
  minLineConf: 45,
  /** Câu dài hơn mức này (ký tự) được chia nhỏ ở dấu ; : , */
  maxSentence: 260,
  /** Phần chia ra không được ngắn hơn mức này. */
  minPiece: 60,
};

type Word = OcrWord & { lineKey: number; lineBox: Box };
type RawParagraph = { words: Word[]; lineHeight: number; firstTop: number; lastBottom: number; left: number; right: number; block: number };

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const UPPER = /^\p{Lu}/u;
const LOWER = /^\p{Ll}/u;
/** Dấu đóng có thể đứng sau dấu kết câu: ngoặc kép, ngoặc đơn... */
const CLOSERS = '"\'”’»)\\]';
const END_RE = new RegExp(`([.!?…]+)[${CLOSERS}]*$`, 'u');
/** Từ chỉ gồm dấu câu thông dụng (được giữ lại dù không có chữ). */
const PUNCT_WORD = /^[-–—.,;:!?…%&/()"'“”‘’«»]{1,3}$/u;
/** Ký tự mở có thể đứng trước chữ đầu câu. */
const OPENERS = /^["'“‘«(\[\-–—•*+]+/u;

/**
 * Viết tắt tiếng Việt thường gặp có dấu chấm nhưng KHÔNG kết thúc câu (so sánh không phân biệt hoa thường, bỏ dấu
 * chấm cuối). Danh xưng, học hàm, đơn vị hành chính, từ viết tắt trong văn bản.
 */
const ABBREVIATIONS = new Set(
  [
    'tp', 'q', 'p', 'h', 'tx', 'tt', 'kp', 'x', // thành phố, quận, phường, huyện, thị xã, thị trấn, khu phố, xã
    'ts', 'ths', 'pgs', 'gs', 'bs', 'ks', 'cn', 'ds', 'nsnd', 'nsut', 'ld', 'ls', // học hàm, học vị, nghề
    'ô', 'mr', 'mrs', 'ms', 'dr', 'st',
    'đ/c', 'đc', 'đt', 'sđt', 'tel', 'fax', 'stt', 'tr', 'vd', 'v.d', 'tk', 'mst', 'cmnd', 'cccd', 'gv', 'hs', 'sv',
    'no', 'vs', 'etc', 'p.s', 'tcn', 'scn', 'tl', 'kt', 'tm', 'nxb', 'đh', 'thpt', 'thcs',
  ].map((s) => s.toLowerCase()),
);

function union(a: Box, b: Box): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Chuẩn hóa chữ của một từ: Unicode dựng sẵn, bỏ ký tự điều khiển / ký tự thay thế. */
function cleanWord(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f�]/g, '')
    .trim();
}

/** Bước 1: bỏ rác, trả các dòng còn lại (từ đã chuẩn hóa). */
export function filterLines(lines: OcrLine[], options = COMPOSE): OcrLine[] {
  const out: OcrLine[] = [];
  for (const line of lines) {
    const words = line.words
      .map((w) => ({ ...w, text: cleanWord(w.text) }))
      .filter((w) => w.text && w.conf >= options.minWordConf)
      // Từ không có chữ / số: chỉ giữ dấu câu thông dụng đứng riêng (gạch nối, ngoặc...); | _ ~ ... là vệt bẩn, đường kẻ.
      .filter((w) => LETTER_OR_DIGIT.test(w.text) || PUNCT_WORD.test(w.text));
    if (!words.length) continue;
    if (!words.some((w) => LETTER_OR_DIGIT.test(w.text))) continue;
    const conf = words.reduce((s, w) => s + w.conf, 0) / words.length;
    if (conf < options.minLineConf) continue;
    out.push({ ...line, words, box: words.map((w) => w.box).reduce(union) });
  }
  return out;
}

function endsWithTerminal(text: string): boolean {
  return /[.!?…:;]["'”’»)\]]*$/u.test(text);
}

function startsListItem(text: string): boolean {
  return /^([-–—•*+]|\(?\d{1,3}[.)]|\(?[a-zđ][.)]|[IVXLC]{1,5}[.)])/u.test(text);
}

/** Bước 2: dòng -> đoạn thô (theo khối + đoạn của Tesseract, rồi nối đoạn bị tách nhầm). */
function buildParagraphs(lines: OcrLine[]): RawParagraph[] {
  const paras: RawParagraph[] = [];
  let key = '';
  let lineKey = 0;
  for (const line of lines) {
    const k = `${line.block}/${line.par}`;
    const words: Word[] = line.words.map((w) => ({ ...w, lineKey, lineBox: line.box }));
    lineKey++;
    const h = line.box[3] - line.box[1];
    if (k !== key || !paras.length) {
      key = k;
      paras.push({ words, lineHeight: h, firstTop: line.box[1], lastBottom: line.box[3], left: line.box[0], right: line.box[2], block: line.block });
    } else {
      const p = paras[paras.length - 1];
      p.words.push(...words);
      p.lineHeight = Math.max(p.lineHeight, h);
      p.lastBottom = line.box[3];
      p.left = Math.min(p.left, line.box[0]);
      p.right = Math.max(p.right, line.box[2]);
    }
  }
  // Chiều cao dòng của đoạn = trung vị chiều cao các dòng (đã lấy max ở trên cho đoạn 1 dòng; tính lại cho chắc).
  for (const p of paras) {
    const heights = new Map<number, number>();
    for (const w of p.words) heights.set(w.lineKey, w.lineBox[3] - w.lineBox[1]);
    p.lineHeight = median([...heights.values()]);
  }

  const merged: RawParagraph[] = [];
  for (const p of paras) {
    const prev = merged[merged.length - 1];
    if (prev && shouldMerge(prev, p)) {
      prev.words.push(...p.words);
      prev.lastBottom = p.lastBottom;
      prev.left = Math.min(prev.left, p.left);
      prev.right = Math.max(prev.right, p.right);
    } else {
      merged.push({ ...p, words: [...p.words] });
    }
  }
  return merged;
}

/**
 * Hai đoạn liên tiếp thật ra là một: câu chưa hết, dòng sau nằm ngay dưới (cùng cột, sát nhau), không phải đầu mục.
 * Dòng sau bắt đầu bằng chữ thường là dấu hiệu mạnh của câu còn tiếp (Tesseract hay tách riêng dòng cuối ngắn của
 * đoạn, có khi sang cả khối khác); bắt đầu bằng chữ hoa thì phải thêm: cùng khối, cỡ chữ như nhau, dòng trước chạy
 * hết lề.
 */
function shouldMerge(a: RawParagraph, b: RawParagraph): boolean {
  const lastText = a.words[a.words.length - 1].text;
  const firstText = b.words[0].text;
  if (endsWithTerminal(lastText)) return false;
  if (startsListItem(firstText)) return false;
  const lh = Math.max(a.lineHeight, b.lineHeight);
  const gap = b.firstTop - a.lastBottom;
  if (gap > 0.9 * lh || gap < -0.5 * lh) return false; // cách đoạn / nhảy sang cột khác
  if (Math.abs(b.left - a.left) > 2 * lh) return false; // lệch lề trái: khối khác
  const ratio = a.lineHeight / Math.max(1, b.lineHeight);
  if (LOWER.test(firstText.replace(OPENERS, ''))) return ratio < 1.8 && ratio > 0.55; // khung dòng ngắn cao thấp thất thường
  if (a.block !== b.block) return false;
  if (ratio > 1.35 || ratio < 0.74) return false; // tiêu đề to + thân bài
  // Dòng cuối của đoạn trước ngắn hẳn (không chạy tới lề phải) mà dòng sau viết hoa: đoạn mới.
  const lastLineKey = a.words[a.words.length - 1].lineKey;
  const lastLineRight = Math.max(...a.words.filter((w) => w.lineKey === lastLineKey).map((w) => w.box[2]));
  const width = Math.max(a.right, b.right) - Math.min(a.left, b.left);
  return lastLineRight >= Math.max(a.right, b.right) - 0.25 * width;
}

/** Từ `word` (bỏ dấu đóng cuối) có phải viết tắt không kết câu, hoặc số thứ tự / đầu mục. */
function isNonTerminalDot(core: string, indexInParagraph: number, sentenceStart: boolean, prev: string | null): boolean {
  const bare = core.replace(/\.+$/, '');
  if (!bare) return false;
  const lower = bare.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  // Viết tắt nhiều phần có chấm ở giữa: T.P, Th.S, P.G.S, U.B.N.D
  if (/^(\p{L}{1,3}\.)+\p{L}{1,3}$/u.test(bare) && ABBREVIATIONS.has(lower.replace(/\./g, ''))) return true;
  // Chữ cái viết hoa đơn lẻ sau một từ viết hoa là tên viết tắt ("Nguyễn V. An"). Sau từ viết thường thì không:
  // "học kỳ I. Buổi họp...", "phương án B. Sau đó..." là hết câu.
  if (/^\p{Lu}$/u.test(bare) && !sentenceStart && prev != null && UPPER.test(prev.replace(OPENERS, ''))) return true;
  // Đầu mục ở đầu câu / đầu đoạn: "1.", "12.", "a.", "IV.", "1.2."
  if (sentenceStart || indexInParagraph === 0) {
    if (/^\(?\d{1,3}(\.\d{1,3})*$/.test(bare)) return true;
    if (/^\(?[a-zđ]$/u.test(bare)) return true;
    if (/^[IVXLC]{1,5}$/.test(bare)) return true;
  }
  return false;
}

/**
 * `word` có kết thúc câu không, biết từ đứng sau là `next` (null: hết đoạn).
 * `sentenceStart`: word là từ đầu tiên của câu đang xét; `prev`: từ đứng trước (null: không có).
 */
export function endsSentence(
  word: string,
  next: string | null,
  indexInParagraph = 1,
  sentenceStart = false,
  prev: string | null = null,
): boolean {
  const m = END_RE.exec(word);
  if (!m) return false;
  if (next == null) return true;
  const mark = m[1];
  const nextCore = next.replace(OPENERS, '');
  if (mark === '.') {
    const core = word.slice(0, m.index + 1);
    // "v.v." : chỉ kết câu khi chữ sau viết hoa.
    if (/^v\.?v\.$/iu.test(core)) return UPPER.test(nextCore);
    if (isNonTerminalDot(core, indexInParagraph, sentenceStart, prev)) return false;
    // Chữ sau viết thường: dấu chấm nằm giữa câu (viết tắt lạ, lỗi OCR).
    if (LOWER.test(nextCore)) return false;
    return true;
  }
  if (mark.includes('…') || /^\.{2,}$/.test(mark)) return !LOWER.test(nextCore); // dấu lửng giữa câu
  // ! ? : kết câu, trừ khi chữ sau viết thường và dấu nằm trong ngoặc kép ("Sao thế?" anh hỏi) — vẫn tách cho dễ nghe.
  return true;
}

/** Ghép các từ thành chuỗi: cách nhau một dấu cách, sửa khoảng trắng thừa quanh dấu câu do OCR. */
export function joinWords(words: string[]): string {
  let s = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = i > 0 ? words[i - 1] : '';
    // Từ bị ngắt dòng bằng gạch nối ("héc-" + "ta"): nối liền, giữ gạch.
    if (i > 0 && /\p{L}-$/u.test(prev) && LOWER.test(w)) s += w;
    else s += (i > 0 ? ' ' : '') + w;
  }
  return s
    .replace(/\s+([,.;:!?…%)\]”’»])/gu, '$1')
    .replace(/([(\[“‘«])\s+/gu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Chia câu quá dài ở dấu ; : , gần giữa nhất (đệ quy). Trả các đoạn chỉ số [start, end) trên mảng từ. */
function splitLong(words: Word[], start: number, end: number, options: typeof COMPOSE): [number, number][] {
  const text = joinWords(words.slice(start, end).map((w) => w.text));
  if (text.length <= options.maxSentence) return [[start, end]];
  for (const marks of [/[;]$/u, /[:]$/u, /[,]$/u]) {
    let best = -1;
    let bestScore = Infinity;
    let pos = 0;
    for (let i = start; i < end - 1; i++) {
      pos += words[i].text.length + 1;
      if (!marks.test(words[i].text)) continue;
      if (pos < options.minPiece || text.length - pos < options.minPiece) continue;
      const score = Math.abs(pos - text.length / 2);
      if (score < bestScore) {
        bestScore = score;
        best = i + 1;
      }
    }
    if (best > 0) return [...splitLong(words, start, best, options), ...splitLong(words, best, end, options)];
  }
  return [[start, end]];
}

function boxesOf(words: Word[]): Box[] {
  const byLine = new Map<number, Box>();
  for (const w of words) {
    const b = byLine.get(w.lineKey);
    byLine.set(w.lineKey, b ? union(b, w.box) : ([...w.box] as Box));
  }
  return [...byLine.values()];
}

/** Bước 3: tách một đoạn thành các khoảng từ [start, end), mỗi khoảng một câu. */
function sentenceRanges(words: Word[], options: typeof COMPOSE): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const next = i + 1 < words.length ? words[i + 1].text : null;
    if (endsSentence(words[i].text, next, i, i === start, i > 0 ? words[i - 1].text : null)) {
      ranges.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < words.length) ranges.push([start, words.length]);
  // Mẩu quá ngắn không có chữ (vd. ")" hay "-") nhập vào câu trước.
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const text = joinWords(words.slice(r[0], r[1]).map((w) => w.text));
    if (merged.length && !LETTER_OR_DIGIT.test(text)) merged[merged.length - 1][1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.flatMap(([a, b]) => splitLong(words, a, b, options));
}

/** Kết quả OCR -> tài liệu để đọc (đoạn + câu theo thứ tự đọc). */
export function composeDocument(lines: OcrLine[], width: number, height: number, options = COMPOSE): ReadingDoc {
  const kept = filterLines(lines, options);
  const raw = buildParagraphs(kept);
  const paragraphs: Paragraph[] = [];
  const sentences: Sentence[] = [];
  let confSum = 0;
  let confN = 0;
  for (const p of raw) {
    const para: Paragraph = { index: paragraphs.length, text: '', box: p.words.map((w) => w.box).reduce(union), sentences: [] };
    for (const [a, b] of sentenceRanges(p.words, options)) {
      const ws = p.words.slice(a, b);
      const text = joinWords(ws.map((w) => w.text));
      if (!text) continue;
      const conf = ws.reduce((s, w) => s + w.conf, 0) / ws.length;
      para.sentences.push(sentences.length);
      sentences.push({ index: sentences.length, paragraph: para.index, text, boxes: boxesOf(ws), conf });
    }
    if (!para.sentences.length) continue;
    para.text = joinWords(p.words.map((w) => w.text));
    paragraphs.push(para);
    for (const w of p.words) {
      confSum += w.conf;
      confN++;
    }
  }
  return { width, height, paragraphs, sentences, conf: confN ? confSum / confN : 0 };
}

/**
 * Chữ đưa cho bộ đọc (TTS) của một câu: bỏ ký hiệu đầu dòng, đổi ký hiệu mà giọng đọc hay đọc sai / bỏ qua.
 * Chữ hiển thị trên màn hình vẫn là `sentence.text`.
 */
export function speakable(text: string): string {
  return text
    .replace(/^[\s•*+·▪◦-]+/u, '')
    .replace(/\s[–—-]\s/g, ', ')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
