// Minimal bidirectional-text support for single lines (Arabic/Hebrew mixed
// with Latin and numbers): enough to draw a line in the right visual order
// and to turn text read from a PDF (visual order) back into reading order.

const RTL_LETTER = /[֐-׿؀-ٟ٪-ۯۺ-ࣿיִ-﷿ﹰ-﻿]/;
const ARABIC_DIGIT = /[٠-٩۰-۹]/;
const LTR_LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
const EURO_DIGIT = /[0-9]/;

export const hasRtl = (s: string) => RTL_LETTER.test(s);

type Cls = 'R' | 'L' | 'EN' | 'AN' | 'N';
function classify(ch: string): Cls {
  if (RTL_LETTER.test(ch)) return 'R';
  if (ARABIC_DIGIT.test(ch)) return 'AN';
  if (EURO_DIGIT.test(ch)) return 'EN';
  if (LTR_LETTER.test(ch) || /\p{L}/u.test(ch)) return 'L';
  return 'N';
}

/** Paragraph direction from the first strong character. */
export function baseDirection(s: string): 'rtl' | 'ltr' {
  for (const ch of s) {
    const c = classify(ch);
    if (c === 'R') return 'rtl';
    if (c === 'L') return 'ltr';
  }
  return 'ltr';
}

export interface BidiRun {
  text: string;
  rtl: boolean;
}

/** Splits a line into runs, returned in visual (left-to-right) order. Each run is in reading order. */
export function visualRuns(line: string, base: 'rtl' | 'ltr' = baseDirection(line)): BidiRun[] {
  const chars = [...line];
  const cls = chars.map(classify);
  // Separators inside numbers ("12,500", "3.5", "1/2") belong to the number.
  for (let i = 1; i < chars.length - 1; i++) {
    if (cls[i] === 'N' && /[,.:/٫٬]/.test(chars[i])) {
      const a = cls[i - 1],
        b = cls[i + 1];
      if ((a === 'EN' || a === 'AN') && a === b) cls[i] = a;
    }
  }
  // Strong direction of each character (numbers count as RTL for neighbouring neutrals in RTL text).
  const dir: ('r' | 'l' | null)[] = cls.map((c) => (c === 'R' ? 'r' : c === 'L' ? 'l' : c === 'EN' || c === 'AN' ? (base === 'rtl' ? 'r' : 'l') : null));
  const resolved: ('r' | 'l')[] = dir.map((d, i) => {
    if (d) return d;
    let prev: 'r' | 'l' | null = null;
    for (let k = i - 1; k >= 0 && !prev; k--) prev = dir[k];
    let next: 'r' | 'l' | null = null;
    for (let k = i + 1; k < dir.length && !next; k++) next = dir[k];
    if (prev && prev === next) return prev;
    return base === 'rtl' ? 'r' : 'l';
  });
  // Numbers and Latin are always laid out left-to-right internally.
  const isLtr = (i: number) => cls[i] === 'L' || cls[i] === 'EN' || cls[i] === 'AN' || resolved[i] === 'l';
  const runs: BidiRun[] = [];
  chars.forEach((ch, i) => {
    const rtl = !isLtr(i);
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.text += ch;
    else runs.push({ text: ch, rtl });
  });
  return base === 'rtl' ? runs.reverse() : runs;
}

/**
 * Text extracted from a PDF is in visual order (glyphs are drawn left to
 * right). Turn a line back into reading order and plain Arabic letters.
 * Pass glyph units (one string per glyph, e.g. a "لا" ligature) when known,
 * so multi-letter glyphs stay intact.
 */
export function visualToLogical(visual: string | string[]): string {
  const units = typeof visual === 'string' ? [...visual] : visual;
  if (!units.some(hasRtl)) return units.join('');
  const cls = units.map((u) => classify([...u][0] ?? ' '));
  // Separators inside numbers belong to the number ("12,500").
  for (let i = 1; i < units.length - 1; i++) {
    if (cls[i] === 'N' && /^[,.:/\u066B\u066C]$/.test(units[i]) && (cls[i - 1] === 'EN' || cls[i - 1] === 'AN') && cls[i - 1] === cls[i + 1]) cls[i] = cls[i - 1];
  }
  const strong = cls.map((c) => (c === 'R' ? 'r' : c === 'L' || c === 'EN' || c === 'AN' ? 'l' : null));
  // Neutrals (spaces, punctuation) between two left-to-right pieces stay with them ("Acme Trading").
  const ltr = strong.map((d, i) => {
    if (d) return d === 'l';
    let prev: string | null = null;
    for (let k = i - 1; k >= 0 && !prev; k--) prev = strong[k];
    let next: string | null = null;
    for (let k = i + 1; k < strong.length && !next; k++) next = strong[k];
    return prev === 'l' && next === 'l';
  });
  const runs: { units: string[]; rtl: boolean }[] = [];
  units.forEach((u, i) => {
    const rtl = !ltr[i];
    const last = runs[runs.length - 1];
    if (last && last.rtl === rtl) last.units.push(u);
    else runs.push({ units: [u], rtl });
  });
  // The line reads right-to-left: reverse the run order and the RTL runs' glyphs.
  const logical = runs
    .reverse()
    .map((r) => (r.rtl ? [...r.units].reverse() : r.units).join(''))
    .join('');
  // Presentation forms (positional glyphs) → base letters.
  return logical.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
