// Replays a page's content stream to find where every glyph and image is drawn.
import { PDFDict, PDFName, PDFStream } from 'pdf-lib';
import { tokenize, type Op, type Operand } from './tokenizer';
import { loadFonts, type FontInfo } from './fonts';

export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Row-vector convention: apply A, then B. */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}
export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}
export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export interface CodeInfo {
  code: number;
  byteStart: number;
  byteEnd: number;
  /** Advance expressed in TJ units (thousandths of text space at font size 1). */
  adv: number;
}

export type ShowPart = { kind: 'str'; codes: CodeInfo[]; bytes: Uint8Array } | { kind: 'num'; v: number };

export interface ShowOpInfo {
  index: number;
  op: string; // Tj, TJ, ', "
  parts: ShowPart[];
  fontRes: string;
  fs: number;
}

export interface Glyph {
  op: number;
  gi: number;
  uni: string | undefined;
  /** Baseline start/end and "up" vector (length = effective font size) in user space. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ux: number;
  uy: number;
  font: FontInfo;
  color: string;
  invisible: boolean;
  /** Character and word spacing relative to font size (Tc/Tfs, Tw/Tfs), horizontal scale. */
  tc: number;
  tw: number;
  hScale: number;
}

export interface ImageObj {
  op: number;
  name?: string;
  inline: boolean;
  /** Maps the unit square to user space. */
  matrix: Matrix;
}

export interface PageContent {
  data: Uint8Array;
  ops: Op[];
  glyphs: Glyph[];
  shows: Map<number, ShowOpInfo>;
  images: ImageObj[];
  fonts: Map<string, FontInfo>;
}

const isNum = (o: Operand): o is number => typeof o === 'number';
const nums = (args: Operand[]) => args.filter(isNum) as number[];

function toHex(r: number, g: number, b: number) {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function colorFrom(values: number[]): string | null {
  if (values.length === 1) return toHex(values[0], values[0], values[0]);
  if (values.length === 3) return toHex(values[0], values[1], values[2]);
  if (values.length === 4) {
    const [c, m, y, k] = values;
    return toHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
  }
  return null;
}

interface GState {
  ctm: Matrix;
  fill: string;
  font: FontInfo | null;
  fontRes: string;
  fs: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  rise: number;
  tr: number;
}

export function interpretContent(data: Uint8Array, resources: PDFDict | undefined): PageContent {
  const ops = tokenize(data);
  const fonts = loadFonts(resources);
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  const glyphs: Glyph[] = [];
  const shows = new Map<number, ShowOpInfo>();
  const images: ImageObj[] = [];

  let gs: GState = { ctm: [...IDENTITY], fill: '#000000', font: null, fontRes: '', fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0 };
  const stack: GState[] = [];
  let tm: Matrix = [...IDENTITY];
  let tlm: Matrix = [...IDENTITY];

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm);
    tm = [...tlm];
  };

  const show = (opIndex: number, opName: string, items: Operand[]) => {
    const font = gs.font;
    const info: ShowOpInfo = { index: opIndex, op: opName, parts: [], fontRes: gs.fontRes, fs: gs.fs };
    shows.set(opIndex, info);
    if (!font) return;
    let gi = 0;
    const fs = gs.fs || 1e-6;
    for (const item of items) {
      if (isNum(item)) {
        info.parts.push({ kind: 'num', v: item });
        tm = mul([1, 0, 0, 1, (-item / 1000) * gs.fs * gs.th, 0], tm);
        continue;
      }
      if (!item || typeof item !== 'object' || !('t' in item) || item.t !== 'str') continue;
      const bytes = item.bytes;
      const codes: CodeInfo[] = [];
      for (let b = 0; b + font.bytesPerCode <= bytes.length; b += font.bytesPerCode) {
        const code = font.bytesPerCode === 2 ? (bytes[b] << 8) | bytes[b + 1] : bytes[b];
        const w0 = font.width(code);
        const isSpace = font.bytesPerCode === 1 && code === 32;
        const tx = (w0 * gs.fs + gs.tc + (isSpace ? gs.tw : 0)) * gs.th;
        const trm = mul(mul([gs.fs * gs.th, 0, 0, gs.fs, 0, gs.rise], tm), gs.ctm);
        const [x0, y0] = apply(trm, 0, 0);
        const [x1, y1] = apply(trm, w0, 0);
        const [ux, uy] = apply(trm, 0, 1);
        const hx = apply(trm, 1, 0);
        const sizeV = Math.hypot(ux - x0, uy - y0) || 1;
        glyphs.push({
          op: opIndex,
          gi: gi++,
          uni: font.toUnicode(code),
          x0,
          y0,
          x1,
          y1,
          ux: ux - x0,
          uy: uy - y0,
          font,
          color: gs.fill,
          invisible: gs.tr === 3 || gs.tr === 7,
          tc: gs.tc / fs,
          tw: gs.tw / fs,
          hScale: Math.hypot(hx[0] - x0, hx[1] - y0) / sizeV,
        });
        codes.push({ code, byteStart: b, byteEnd: b + font.bytesPerCode, adv: w0 * 1000 + ((gs.tc + (isSpace ? gs.tw : 0)) * 1000) / fs });
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
      info.parts.push({ kind: 'str', codes, bytes });
    }
  };

  ops.forEach((o, i) => {
    const a = o.args;
    switch (o.op) {
      case 'q':
        stack.push({ ...gs, ctm: [...gs.ctm] as Matrix });
        break;
      case 'Q':
        if (stack.length) gs = stack.pop()!;
        break;
      case 'cm': {
        const m = nums(a);
        if (m.length === 6) gs.ctm = mul(m as Matrix, gs.ctm);
        break;
      }
      case 'g':
      case 'rg':
      case 'k':
      case 'sc':
      case 'scn': {
        const c = colorFrom(nums(a));
        if (c) gs.fill = c;
        break;
      }
      case 'cs':
        gs.fill = '#000000';
        break;
      case 'BT':
        tm = [...IDENTITY];
        tlm = [...IDENTITY];
        break;
      case 'Tc':
        gs.tc = nums(a)[0] ?? 0;
        break;
      case 'Tw':
        gs.tw = nums(a)[0] ?? 0;
        break;
      case 'Tz':
        gs.th = (nums(a)[0] ?? 100) / 100;
        break;
      case 'TL':
        gs.tl = nums(a)[0] ?? 0;
        break;
      case 'Ts':
        gs.rise = nums(a)[0] ?? 0;
        break;
      case 'Tr':
        gs.tr = nums(a)[0] ?? 0;
        break;
      case 'Tf': {
        const name = a[0] && typeof a[0] === 'object' && 't' in a[0] && a[0].t === 'name' ? a[0].v : '';
        gs.fontRes = name;
        gs.font = fonts.get(name) ?? null;
        gs.fs = nums(a)[0] ?? 0;
        break;
      }
      case 'Td': {
        const [tx = 0, ty = 0] = nums(a);
        tlm = mul([1, 0, 0, 1, tx, ty], tlm);
        tm = [...tlm];
        break;
      }
      case 'TD': {
        const [tx = 0, ty = 0] = nums(a);
        gs.tl = -ty;
        tlm = mul([1, 0, 0, 1, tx, ty], tlm);
        tm = [...tlm];
        break;
      }
      case 'Tm': {
        const m = nums(a);
        if (m.length === 6) {
          tlm = m as Matrix;
          tm = [...tlm];
        }
        break;
      }
      case 'T*':
        nextLine();
        break;
      case 'Tj':
        show(i, 'Tj', a.slice(-1));
        break;
      case "'":
        nextLine();
        show(i, "'", a.slice(-1));
        break;
      case '"': {
        const [aw = 0, ac = 0] = nums(a);
        gs.tw = aw;
        gs.tc = ac;
        nextLine();
        show(i, '"', a.slice(-1));
        break;
      }
      case 'TJ': {
        const arr = a[a.length - 1];
        if (arr && typeof arr === 'object' && 't' in arr && arr.t === 'arr') show(i, 'TJ', arr.v);
        break;
      }
      case 'Do': {
        const name = a[0] && typeof a[0] === 'object' && 't' in a[0] && a[0].t === 'name' ? a[0].v : '';
        const xo = xobjects instanceof PDFDict ? xobjects.lookup(PDFName.of(name)) : undefined;
        if (xo instanceof PDFStream && xo.dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image') {
          images.push({ op: i, name, inline: false, matrix: [...gs.ctm] as Matrix });
        }
        break;
      }
      case 'BI':
        images.push({ op: i, inline: true, matrix: [...gs.ctm] as Matrix });
        break;
    }
  });

  return { data, ops, glyphs, shows, images, fonts };
}
