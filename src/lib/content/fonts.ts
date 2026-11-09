// Reads what we need from PDF font dictionaries: glyph widths (for positions),
// code → Unicode (to show existing text) and Unicode → code (to write new text
// with the document's own font).
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib';
import { Encodings, Font as StdFont } from '@pdf-lib/standard-fonts';
import type { FontFamily } from '../types';

export interface FontInfo {
  resName: string;
  baseFont: string;
  /** Font is a subset (name like ABCDEF+Calibri): only glyphs used in the file exist. */
  subset: boolean;
  /** Composite (Type0) fonts use 2-byte codes. */
  bytesPerCode: 1 | 2;
  /** Glyph advance in text-space units per 1 unit of font size (usually width/1000). */
  width(code: number): number;
  toUnicode(code: number): string | undefined;
  /** Unicode char → code, or undefined when the font can't print it. */
  fromUnicode(ch: string): number | undefined;
  ascent: number;
  descent: number;
  fallback: { family: FontFamily; bold: boolean; italic: boolean };
  displayName: string;
}

const lookup = (dict: PDFDict | undefined, key: string) => dict?.lookup(PDFName.of(key));
const numOf = (o: unknown, d = 0) => (o instanceof PDFNumber ? o.asNumber() : d);
const nameOf = (o: unknown) => (o instanceof PDFName ? o.decodeText() : undefined);

export function streamBytes(s: unknown): Uint8Array | undefined {
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s instanceof PDFStream && 'getUnencodedContents' in s) return (s as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents();
  return undefined;
}

// ---------- Glyph names ----------

let winAnsi: { codeToName: Map<number, string>; nameToUni: Map<string, string>; codeToUni: Map<number, string> } | null = null;
function winAnsiTables() {
  if (winAnsi) return winAnsi;
  const codeToName = new Map<number, string>();
  const nameToUni = new Map<string, string>();
  const codeToUni = new Map<number, string>();
  const enc = Encodings.WinAnsi;
  for (const cp of enc.supportedCodePoints) {
    const { code, name } = enc.encodeUnicodeCodePoint(cp);
    const ch = String.fromCodePoint(cp);
    if (!codeToName.has(code)) codeToName.set(code, name);
    if (!codeToUni.has(code)) codeToUni.set(code, ch);
    nameToUni.set(name, ch);
  }
  // Common names outside WinAnsi.
  Object.entries({ fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', minus: '−', nbspace: ' ', sfthyphen: '­' }).forEach(([k, v]) =>
    nameToUni.set(k, v),
  );
  winAnsi = { codeToName, nameToUni, codeToUni };
  return winAnsi;
}

function glyphNameToUnicode(name: string): string | undefined {
  const t = winAnsiTables();
  const direct = t.nameToUni.get(name);
  if (direct) return direct;
  let m = /^uni([0-9A-Fa-f]{4,})$/.exec(name);
  if (m) {
    const hex = m[1];
    let s = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  }
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  const base = name.split('.')[0];
  if (base !== name) return glyphNameToUnicode(base);
  return undefined;
}

const MAC_ROMAN = (() => {
  try {
    const d = new TextDecoder('macintosh');
    return (code: number) => d.decode(Uint8Array.of(code));
  } catch {
    return null;
  }
})();

// ---------- ToUnicode CMaps ----------

function utf16be(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return s;
}

function parseHexTokens(src: string): string[] {
  return src.match(/<[0-9A-Fa-f\s]*>|\[|\]/g) ?? [];
}
const hexToBytes = (h: string) => {
  const s = h.replace(/[<>\s]/g, '');
  const out = new Uint8Array(Math.ceil(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2).padEnd(2, '0'), 16);
  return out;
};
const hexToNum = (h: string) => parseInt(h.replace(/[<>\s]/g, '') || '0', 16);

function parseToUnicode(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const blocks = text.matchAll(/beginbf(char|range)([\s\S]*?)endbf\1/g);
  for (const [, kind, body] of blocks) {
    const toks = parseHexTokens(body);
    if (kind === 'char') {
      for (let i = 0; i + 1 < toks.length; i += 2) map.set(hexToNum(toks[i]), utf16be(hexToBytes(toks[i + 1])));
    } else {
      let i = 0;
      while (i + 2 < toks.length) {
        const lo = hexToNum(toks[i]);
        const hi = hexToNum(toks[i + 1]);
        if (toks[i + 2] === '[') {
          let j = i + 3;
          let code = lo;
          while (j < toks.length && toks[j] !== ']') map.set(code++, utf16be(hexToBytes(toks[j++])));
          i = j + 1;
        } else {
          const base = utf16be(hexToBytes(toks[i + 2]));
          if (base && hi - lo <= 0xffff) {
            const head = base.slice(0, -1);
            const last = base.charCodeAt(base.length - 1);
            // The destination increments by one for each code in the range.
            for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + c - lo));
          }
          i += 3;
        }
      }
    }
  }
  return map;
}

// ---------- Font loading ----------

function fallbackFor(baseFont: string, flags: number): FontInfo['fallback'] {
  const n = baseFont.replace(/^[A-Z]{6}\+/, '');
  const family: FontFamily = /courier|mono|consol|menlo|lucidaconsole/i.test(n) || flags & 1
    ? 'Courier'
    : /times|serif|georgia|garamond|cambria|book|minion|palatino|roman/i.test(n) && !/sans/i.test(n)
      ? 'Times'
      : flags & 2 && !/sans|arial|helvet|calibri|verdana|segoe|roboto|open/i.test(n)
        ? 'Times'
        : 'Helvetica';
  const bold = /bold|black|heavy|semibold|demi/i.test(n) || !!(flags & 0x40000);
  const italic = /italic|oblique/i.test(n) || !!(flags & 64);
  return { family, bold, italic };
}

const STD14: Record<string, string> = {
  Helvetica: 'Helvetica', 'Helvetica-Bold': 'Helvetica-Bold', 'Helvetica-Oblique': 'Helvetica-Oblique', 'Helvetica-BoldOblique': 'Helvetica-BoldOblique',
  'Times-Roman': 'Times-Roman', 'Times-Bold': 'Times-Bold', 'Times-Italic': 'Times-Italic', 'Times-BoldItalic': 'Times-BoldItalic',
  Courier: 'Courier', 'Courier-Bold': 'Courier-Bold', 'Courier-Oblique': 'Courier-Oblique', 'Courier-BoldOblique': 'Courier-BoldOblique',
  Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', 'Arial-BoldMT': 'Helvetica-Bold', ArialMT: 'Helvetica', TimesNewRoman: 'Times-Roman',
  'TimesNewRoman,Bold': 'Times-Bold', TimesNewRomanPSMT: 'Times-Roman', 'TimesNewRomanPS-BoldMT': 'Times-Bold', CourierNew: 'Courier',
};

export function loadFont(resName: string, dict: PDFDict): FontInfo {
  const subtype = nameOf(lookup(dict, 'Subtype')) ?? 'Type1';
  const baseFont = nameOf(lookup(dict, 'BaseFont')) ?? resName;
  const type0 = subtype === 'Type0';
  const descendant = type0 ? (lookup(dict, 'DescendantFonts') as PDFArray | undefined)?.lookup(0, PDFDict) : undefined;
  const descriptor = (lookup(descendant ?? dict, 'FontDescriptor') as PDFDict | undefined) ?? undefined;
  const flags = numOf(lookup(descriptor, 'Flags'));
  let ascent = numOf(lookup(descriptor, 'Ascent'), 0) / 1000;
  let descent = numOf(lookup(descriptor, 'Descent'), 0) / 1000;

  // --- code → unicode
  const toUni = new Map<number, string>();
  const tu = lookup(dict, 'ToUnicode');
  const tuBytes = streamBytes(tu);
  if (tuBytes) parseToUnicode(new TextDecoder('latin1').decode(tuBytes)).forEach((v, k) => toUni.set(k, v));

  let encodingCodeToUni: ((c: number) => string | undefined) | null = null;
  let encodingCodeToName: ((c: number) => string | undefined) | null = null;
  if (!type0) {
    const enc = lookup(dict, 'Encoding');
    const baseName = enc instanceof PDFName ? enc.decodeText() : enc instanceof PDFDict ? nameOf(enc.lookup(PDFName.of('BaseEncoding'))) : undefined;
    const t = winAnsiTables();
    const differences = new Map<number, string>();
    if (enc instanceof PDFDict) {
      const diffs = enc.lookup(PDFName.of('Differences'));
      if (diffs instanceof PDFArray) {
        let code = 0;
        for (const item of diffs.asArray()) {
          if (item instanceof PDFNumber) code = item.asNumber();
          else if (item instanceof PDFName) differences.set(code++, item.decodeText());
        }
      }
    }
    const symbolic = !!(flags & 4) && !(flags & 32);
    encodingCodeToName = (c) => differences.get(c) ?? (baseName === 'MacRomanEncoding' ? undefined : t.codeToName.get(c));
    encodingCodeToUni = (c) => {
      const d = differences.get(c);
      if (d) return glyphNameToUnicode(d);
      if (baseName === 'MacRomanEncoding' && MAC_ROMAN) return MAC_ROMAN(c);
      if (symbolic && !baseName) return undefined;
      return t.codeToUni.get(c) ?? (c >= 32 && c < 127 ? String.fromCharCode(c) : undefined);
    };
  }

  // --- widths
  let width: (code: number) => number;
  if (type0) {
    const dw = numOf(lookup(descendant, 'DW'), 1000);
    const widths = new Map<number, number>();
    const w = lookup(descendant, 'W');
    if (w instanceof PDFArray) {
      const arr = Array.from({ length: w.size() }, (_, k) => w.lookup(k));
      for (let i = 0; i < arr.length; ) {
        const first = numOf(arr[i]);
        const next = arr[i + 1];
        if (next instanceof PDFArray) {
          for (let k = 0; k < next.size(); k++) widths.set(first + k, numOf(next.lookup(k)));
          i += 2;
        } else {
          const last = numOf(next);
          const v = numOf(arr[i + 2]);
          for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, v);
          i += 3;
        }
      }
    }
    // Identity-H assumed: code = CID.
    width = (code) => (widths.get(code) ?? dw) / 1000;
  } else {
    const first = numOf(lookup(dict, 'FirstChar'));
    const widthsArr = lookup(dict, 'Widths');
    const missing = numOf(lookup(descriptor, 'MissingWidth'), 0);
    let fontMatrixScale = 0.001;
    if (subtype === 'Type3') {
      const fm = lookup(dict, 'FontMatrix');
      if (fm instanceof PDFArray) fontMatrixScale = numOf(fm.lookup(0));
    }
    if (widthsArr instanceof PDFArray) {
      const ws = Array.from({ length: widthsArr.size() }, (_, k) => numOf(widthsArr.lookup(k)));
      width = (code) => {
        const v = ws[code - first];
        return (v === undefined ? missing : v) * fontMatrixScale;
      };
    } else {
      // Standard 14 font without widths: use built-in metrics.
      const std = STD14[baseFont.replace(/^[A-Z]{6}\+/, '')] ?? (fallbackFor(baseFont, flags).family === 'Courier' ? 'Courier' : fallbackFor(baseFont, flags).family === 'Times' ? 'Times-Roman' : 'Helvetica');
      let metrics: StdFont | null = null;
      try {
        metrics = StdFont.load(std as never);
        if (!ascent && metrics.Ascender) ascent = (metrics.Ascender as number) / 1000;
        if (!descent && metrics.Descender) descent = (metrics.Descender as number) / 1000;
      } catch {
        metrics = null;
      }
      width = (code) => {
        const name = encodingCodeToName?.(code);
        const w = name && metrics ? metrics.getWidthOfGlyph(name) : undefined;
        return (typeof w === 'number' ? w : 500) / 1000;
      };
    }
  }

  const toUnicode = (code: number) => toUni.get(code) ?? encodingCodeToUni?.(code);

  // --- unicode → code (only single-character mappings)
  const reverse = new Map<string, number>();
  const addReverse = (code: number, s: string | undefined) => {
    if (s && [...s].length === 1 && !reverse.has(s)) reverse.set(s, code);
  };
  toUni.forEach((s, code) => addReverse(code, s));
  if (!type0 && encodingCodeToUni) for (let c = 0; c < 256; c++) addReverse(c, encodingCodeToUni(c));

  if (!ascent || ascent < 0.4 || ascent > 1.3) ascent = 0.9;
  if (!descent || descent > 0 || descent < -0.6) descent = -0.22;

  const clean = baseFont.replace(/^[A-Z]{6}\+/, '');
  return {
    resName,
    baseFont,
    subset: /^[A-Z]{6}\+/.test(baseFont),
    bytesPerCode: type0 ? 2 : 1,
    width,
    toUnicode,
    fromUnicode: (ch) => reverse.get(ch),
    ascent,
    descent: Math.abs(descent),
    fallback: fallbackFor(baseFont, flags),
    displayName: clean.replace(/[-,](Regular|Roman|PSMT|MT)$/i, '').replace(/PSMT|MT$/, '').replace(/[-,]/g, ' ') || resName,
  };
}

/** Loads all fonts referenced by a resources dictionary. */
export function loadFonts(resources: PDFDict | undefined): Map<string, FontInfo> {
  const out = new Map<string, FontInfo>();
  const fonts = resources?.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) return out;
  for (const [key] of fonts.entries()) {
    const d = fonts.lookup(key);
    if (d instanceof PDFDict) {
      try {
        out.set(key.decodeText(), loadFont(key.decodeText(), d));
      } catch (err) {
        console.warn('Font could not be read', key.decodeText(), err);
      }
    }
  }
  return out;
}
