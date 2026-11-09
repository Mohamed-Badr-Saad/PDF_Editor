// Character positions of a page's text (real PDF text + OCR), for selecting
// text, marking it up and finding words.
import { useStore, ocrKey } from '../state/store';
import { getAnalysis } from './content/editorBridge';
import type { PageItem } from './types';
import { hasRtl, visualToLogical } from './bidi';

export interface LayoutChar {
  ch: string;
  x0: number;
  x1: number;
}
export interface LayoutLine {
  top: number;
  bottom: number;
  chars: LayoutChar[];
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lines of selectable text in reading order (base space). */
export async function getTextLayout(page: PageItem): Promise<LayoutLine[]> {
  const st = useStore.getState();
  const removed = new Set(st.present.removed[page.id] ?? []);
  const pieces: { top: number; bottom: number; base: number; size: number; chars: LayoutChar[] }[] = [];
  const analysis = await getAnalysis(page);
  for (const sg of analysis?.segments ?? []) {
    if (sg.angle !== 0 || removed.has(sg.glyphIds[0])) continue;
    pieces.push({ top: sg.box.y, bottom: sg.box.y + sg.box.h, base: sg.originY, size: sg.fontSize, chars: sg.glyphBoxes });
  }
  const ocr = st.ocr[ocrKey(page)];
  for (const l of ocr?.lines ?? []) {
    if (Math.abs(l.angle) > 2 || removed.has(l.id)) continue;
    const chars: LayoutChar[] = [];
    l.words.forEach((w, i) => {
      const glyphs = [...w.text];
      const step = w.w / Math.max(1, glyphs.length);
      // Right-to-left words run from the right edge.
      const rtl = l.rtl;
      glyphs.forEach((ch, k) => {
        const x0 = rtl ? w.x + w.w - (k + 1) * step : w.x + k * step;
        chars.push({ ch, x0, x1: x0 + step });
      });
      const next = l.words[i + 1];
      if (next) chars.push({ ch: ' ', x0: Math.min(w.x + w.w, next.x), x1: Math.max(w.x + w.w, next.x) });
    });
    pieces.push({ top: l.box.y, bottom: l.box.y + l.box.h, base: l.y, size: l.fontSize, chars });
  }
  // Merge pieces that share a baseline into lines.
  pieces.sort((a, b) => a.base - b.base || a.chars[0]?.x0 - b.chars[0]?.x0);
  const lines: (LayoutLine & { base: number; size: number })[] = [];
  for (const p of pieces) {
    if (!p.chars.length) continue;
    const line = lines.find((l) => Math.abs(l.base - p.base) < 0.3 * Math.max(l.size, p.size));
    if (line) {
      const last = line.chars[line.chars.length - 1];
      const insertAtEnd = p.chars[0].x0 >= last.x1 - 0.5;
      if (insertAtEnd && p.chars[0].x0 - last.x1 > 0.15 * p.size) line.chars.push({ ch: ' ', x0: last.x1, x1: p.chars[0].x0 });
      line.chars.push(...p.chars);
      if (!insertAtEnd) line.chars.sort((a, b) => a.x0 - b.x0);
      line.top = Math.min(line.top, p.top);
      line.bottom = Math.max(line.bottom, p.bottom);
    } else lines.push({ ...p, chars: [...p.chars] });
  }
  lines.sort((a, b) => a.top - b.top);
  // Characters in visual (left-to-right) order; Arabic is turned back into reading order when copied.
  for (const l of lines) l.chars.sort((a, b) => a.x0 - b.x0);
  return lines.map(({ top, bottom, chars }) => ({ top, bottom, chars }));
}

/** Selected characters (visual order) → text in reading order. */
function readingText(chars: LayoutChar[]): string {
  const units = chars.map((c) => c.ch);
  return (units.some(hasRtl) ? visualToLogical(units) : units.join('')).trim();
}

/** Caret position (line, index between characters) nearest to a point. */
function caretAt(lines: LayoutLine[], x: number, y: number): { line: number; index: number } | null {
  if (!lines.length) return null;
  let best = 0;
  let bestD = Infinity;
  lines.forEach((l, i) => {
    const d = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const chars = lines[best].chars;
  let index = chars.length;
  for (let k = 0; k < chars.length; k++) {
    if (x < (chars[k].x0 + chars[k].x1) / 2) {
      index = k;
      break;
    }
  }
  return { line: best, index };
}

export interface TextSelection {
  quads: Box[];
  text: string;
}

/** Text between two points, like dragging a selection in a document. */
export function selectBetween(lines: LayoutLine[], ax: number, ay: number, bx: number, by: number): TextSelection | null {
  let a = caretAt(lines, ax, ay);
  let b = caretAt(lines, bx, by);
  if (!a || !b) return null;
  if (b.line < a.line || (b.line === a.line && b.index < a.index)) [a, b] = [b, a];
  const quads: Box[] = [];
  const parts: string[] = [];
  for (let i = a.line; i <= b.line; i++) {
    const l = lines[i];
    const from = i === a.line ? a.index : 0;
    const to = i === b.line ? b.index : l.chars.length;
    const sel = l.chars.slice(from, to);
    const visible = sel.filter((c) => c.ch.trim());
    if (!visible.length) continue;
    const x0 = Math.min(...visible.map((c) => c.x0));
    const x1 = Math.max(...visible.map((c) => c.x1));
    quads.push({ x: x0, y: l.top, w: x1 - x0, h: l.bottom - l.top });
    parts.push(readingText(sel));
  }
  if (!quads.length) return null;
  return { quads, text: parts.join('\n') };
}

function selectionFromRange(lines: LayoutLine[], a: { line: number; index: number }, b: { line: number; index: number }): TextSelection | null {
  const quads: Box[] = [];
  const parts: string[] = [];
  for (let i = a.line; i <= b.line; i++) {
    const l = lines[i];
    const sel = l.chars.slice(i === a.line ? a.index : 0, i === b.line ? b.index : l.chars.length);
    const visible = sel.filter((c) => c.ch.trim());
    if (!visible.length) continue;
    const x0 = Math.min(...visible.map((c) => c.x0));
    const x1 = Math.max(...visible.map((c) => c.x1));
    quads.push({ x: x0, y: l.top, w: x1 - x0, h: l.bottom - l.top });
    parts.push(readingText(sel));
  }
  return quads.length ? { quads, text: parts.join('\n') } : null;
}

/** Character under a point (only when the point is on a line of text). */
function charAt(lines: LayoutLine[], x: number, y: number): { line: number; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (y < l.top - 1 || y > l.bottom + 1) continue;
    for (let k = 0; k < l.chars.length; k++) if (x >= l.chars[k].x0 - 0.5 && x <= l.chars[k].x1 + 0.5) return { line: i, index: k };
  }
  return null;
}

/** True when the point is over text (for the I-beam cursor). */
export function isOverText(lines: LayoutLine[], x: number, y: number): boolean {
  return lines.some((l) => y >= l.top && y <= l.bottom && l.chars.length > 0 && x >= l.chars[0].x0 - 2 && x <= l.chars[l.chars.length - 1].x1 + 2);
}

/** Double-click: the word under the point. */
export function selectWord(lines: LayoutLine[], x: number, y: number): TextSelection | null {
  const c = charAt(lines, x, y);
  if (!c) return null;
  const chars = lines[c.line].chars;
  const isWord = (ch: string) => !!ch.trim() && !/[.,;:!?()"“”'‘’]/.test(ch);
  if (!isWord(chars[c.index].ch)) return selectionFromRange(lines, c, { line: c.line, index: c.index + 1 });
  let s = c.index,
    e = c.index + 1;
  while (s > 0 && isWord(chars[s - 1].ch)) s--;
  while (e < chars.length && isWord(chars[e].ch)) e++;
  return selectionFromRange(lines, { line: c.line, index: s }, { line: c.line, index: e });
}

/** Triple-click: the whole line under the point. */
export function selectLine(lines: LayoutLine[], x: number, y: number): TextSelection | null {
  const c = charAt(lines, x, y);
  if (!c) return null;
  return selectionFromRange(lines, { line: c.line, index: 0 }, { line: c.line, index: lines[c.line].chars.length });
}

/** Ctrl+A: all text on the page. */
export function selectAllText(lines: LayoutLine[]): TextSelection | null {
  if (!lines.length) return null;
  return selectionFromRange(lines, { line: 0, index: 0 }, { line: lines.length - 1, index: lines[lines.length - 1].chars.length });
}

/** Text covered by boxes (used to quote what a comment refers to). */
export function textInBoxes(lines: LayoutLine[], boxes: Box[]): string {
  const out: string[] = [];
  for (const l of lines) {
    const mid = (l.top + l.bottom) / 2;
    const chars = l.chars.filter((c) => {
      const cx = (c.x0 + c.x1) / 2;
      return boxes.some((b) => cx >= b.x && cx <= b.x + b.w && mid >= b.y && mid <= b.y + b.h);
    });
    const t = readingText(chars);
    if (t) out.push(t);
  }
  return out.join(' ');
}

/** Finds all occurrences of `query` (case-insensitive) and returns their boxes. */
export function findInLayout(lines: LayoutLine[], query: string): Box[][] {
  let q = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!q) return [];
  // Page text is in visual order, so look for Arabic words written backwards.
  if (hasRtl(q)) q = [...q].reverse().join('');
  const results: Box[][] = [];
  for (const l of lines) {
    // Normalised text with a map back to character positions.
    let text = '';
    const map: number[] = [];
    l.chars.forEach((c, k) => {
      let n = c.ch.normalize('NFKC').toLocaleLowerCase();
      if (hasRtl(n) && n.length > 1) n = [...n].reverse().join('');
      for (let j = 0; j < n.length; j++) map.push(k);
      text += n;
    });
    let from = 0;
    for (;;) {
      const i = text.indexOf(q, from);
      if (i < 0) break;
      const sel = l.chars.slice(map[i], map[i + q.length - 1] + 1);
      const x0 = Math.min(...sel.map((c) => c.x0));
      const x1 = Math.max(...sel.map((c) => c.x1));
      results.push([{ x: x0, y: l.top, w: x1 - x0, h: l.bottom - l.top }]);
      from = i + Math.max(1, q.length);
    }
  }
  return results;
}
