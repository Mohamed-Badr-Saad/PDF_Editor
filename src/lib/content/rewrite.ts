// Removes glyphs and images from a content stream without disturbing anything
// else: removed glyphs become equivalent spacing, so the rest of the line keeps
// its exact position.
import { hexString, num, type Operand } from './tokenizer';
import type { PageContent } from './interpret';
import type { FontInfo } from './fonts';

const enc = new TextEncoder();

/** `removed` holds "op.glyph" ids for glyphs and "op" ids for whole operators (images). */
export function rewriteContent(content: PageContent, removed: Iterable<string>): Uint8Array {
  const glyphsByOp = new Map<number, Set<number>>();
  const wholeOps = new Set<number>();
  for (const id of removed) {
    const dot = id.indexOf('.');
    if (dot < 0) wholeOps.add(Number(id));
    else {
      const op = Number(id.slice(0, dot));
      let s = glyphsByOp.get(op);
      if (!s) glyphsByOp.set(op, (s = new Set()));
      s.add(Number(id.slice(dot + 1)));
    }
  }

  const replacements = new Map<number, string>();
  wholeOps.forEach((i) => {
    const op = content.ops[i];
    if (op && (op.op === 'Do' || op.op === 'BI')) replacements.set(i, '');
  });
  glyphsByOp.forEach((gset, i) => {
    const info = content.shows.get(i);
    const op = content.ops[i];
    if (!info || !op) return;
    const elements: string[] = [];
    let pending = 0;
    let chunk: number[] = [];
    const flushChunk = () => {
      if (chunk.length) elements.push(hexString(chunk));
      chunk = [];
    };
    const flushPending = () => {
      if (pending) {
        flushChunk();
        elements.push(num(-pending));
        pending = 0;
      }
    };
    let gi = 0;
    for (const part of info.parts) {
      if (part.kind === 'num') {
        flushChunk();
        pending -= part.v; // a TJ number n advances by -n
        continue;
      }
      for (const c of part.codes) {
        if (gset.has(gi)) {
          pending += c.adv;
        } else {
          flushPending();
          for (let b = c.byteStart; b < c.byteEnd; b++) chunk.push(part.bytes[b]);
        }
        gi++;
      }
      flushChunk();
    }
    flushPending();
    let prefix = '';
    if (op.op === "'") prefix = 'T* ';
    if (op.op === '"') {
      const n = op.args.filter((a: Operand): a is number => typeof a === 'number');
      prefix = `${num(n[0] ?? 0)} Tw ${num(n[1] ?? 0)} Tc T* `;
    }
    replacements.set(i, `${prefix}[${elements.join(' ')}] TJ`);
  });

  if (!replacements.size) return content.data;
  const chunks: Uint8Array[] = [];
  let last = 0;
  const sorted = [...replacements.keys()].sort((a, b) => a - b);
  for (const i of sorted) {
    const op = content.ops[i];
    chunks.push(content.data.subarray(last, op.start));
    chunks.push(enc.encode(replacements.get(i)!));
    last = op.end;
  }
  chunks.push(content.data.subarray(last));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/**
 * Encodes text with an existing PDF font. Returns TJ array elements (hex
 * strings and spacing numbers), or null if a character isn't available.
 * Spaces missing from subset fonts are written as spacing instead.
 */
export function encodeWithFont(font: FontInfo, text: string, allowed: string): (Uint8Array | number)[] | null {
  const out: (Uint8Array | number)[] = [];
  let cur: number[] = [];
  const spaceCode = allowed.includes(' ') ? font.fromUnicode(' ') : undefined;
  const flush = () => {
    if (cur.length) out.push(Uint8Array.from(cur));
    cur = [];
  };
  for (const ch of text) {
    if (ch === ' ' && spaceCode === undefined) {
      flush();
      out.push(-250);
      continue;
    }
    const code = allowed.includes(ch) ? font.fromUnicode(ch) : undefined;
    if (code === undefined) return null;
    if (font.bytesPerCode === 2) cur.push((code >> 8) & 255, code & 255);
    else cur.push(code & 255);
  }
  flush();
  return out;
}
