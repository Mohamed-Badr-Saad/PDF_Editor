// Invisible, searchable text over scanned pages (what Acrobat calls "Recognize Text").
// Uses a tiny glyph-less font: every character maps to an empty glyph, and a
// ToUnicode map makes the text searchable and copyable in any PDF reader.
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFPage,
  PDFRef,
  PDFString,
  TextRenderingMode,
  beginText,
  endText,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from 'pdf-lib';
import type { OcrLine } from '../types';

const GLYPHLESS_TTF = 'AAEAAAAKAIAAAwAgT1MvMkT/RUAAAAEoAAAAYGNtYXAADABzAAABkAAAADRnbHlmAAAAAAAAAcwAAAABaGVhZC1CWxwAAACsAAAANmhoZWED6QH2AAAA5AAAACRobXR4AfQAAAAAAYgAAAAGbG9jYQAAAAAAAAHEAAAABm1heHAAAwACAAABCAAAACBuYW1lGZ8ZNAAAAdAAAABycG9zdAAHAAAAAAJEAAAAJgABAAAAAQAAgfElBl8PPPUAAwPoAAAAAOcWDR4AAAAA5xYNHgAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAPoAAAAAAH0AAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwH0AZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACAAIAPoAAAAAAPoAAAAAAAAAAAAAAAAAAAAAAAgAAAB9AAAAAAAAAAAAAIAAAADAAAAFAADAAEAAAAUAAQAIAAAAAQABAABAAAAIP//AAAAIP///+EAAQAAAAAAAAAAAAAAAAAAAAAAAAAEADYAAQAAAAAAAQANAAAAAQAAAAAAAgAHAA0AAwABBAkAAQAaABQAAwABBAkAAgAOAC5HbHlwaExlc3NGb250UmVndWxhcgBHAGwAeQBwAGgATABlAHMAcwBGAG8AbgB0AFIAZQBnAHUAbABhAHIAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAADAAA=';

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ToUnicode CMap: 2-byte codes are UTF-16 code units. */
function identityToUnicode(): string {
  const ranges: string[] = [];
  for (let hi = 0; hi < 256; hi++) {
    const h = hi.toString(16).padStart(2, '0');
    ranges.push(`<${h}00> <${h}ff> <${h}00>`);
  }
  const chunks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) {
    const part = ranges.slice(i, i + 100);
    chunks.push(`${part.length} beginbfrange\n${part.join('\n')}\nendbfrange`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <ffff>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** Adds the glyph-less font to a document once; returns its reference. */
export function addOcrFont(doc: PDFDocument): PDFRef {
  const ctx = doc.context;
  const ttf = base64ToBytes(GLYPHLESS_TTF);
  const fontFile = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = ctx.register(
    ctx.obj({
      Type: 'FontDescriptor',
      FontName: 'GlyphLessFont',
      Flags: 5,
      FontBBox: [0, 0, 500, 1000],
      ItalicAngle: 0,
      Ascent: 1000,
      Descent: 0,
      CapHeight: 1000,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  // Every CID maps to glyph 1 (an empty glyph).
  const map = new Uint8Array(65536 * 2);
  for (let i = 1; i < map.length; i += 2) map[i] = 1;
  const cidToGid = ctx.register(ctx.flateStream(map));
  const cidFont = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'GlyphLessFont',
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: 500,
      CIDToGIDMap: cidToGid,
    }),
  );
  const toUnicode = ctx.register(ctx.flateStream(identityToUnicode()));
  const descendants = PDFArray.withContext(ctx);
  descendants.push(cidFont);
  return ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'GlyphLessFont',
      Encoding: 'Identity-H',
      DescendantFonts: descendants,
      ToUnicode: toUnicode,
    }),
  );
}

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

const utf16Hex = (s: string) => {
  let h = '';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, '0');
  return h;
};

/**
 * Draws OCR words as invisible text. Must be called while the page's
 * transformation is set to base space (y up), like annotations.
 */
export function drawOcrText(page: PDFPage, fontRef: PDFRef, lines: OcrLine[], H: number) {
  if (!lines.length) return;
  const name = page.node.newFontDictionary('OCR', fontRef);
  page.pushOperators(beginText(), setTextRenderingMode(TextRenderingMode.Invisible));
  for (const line of lines) {
    const fs = Math.max(1, line.fontSize);
    const rad = (line.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    page.pushOperators(setFontAndSize(name, fs));
    line.words.forEach((w, i) => {
      // Right-to-left words are stored in visual order, as PDF readers expect.
      const word = RTL.test(w.text) ? [...w.text].reverse().join('') : w.text;
      // A trailing space keeps words apart when the text is copied.
      const text = i < line.words.length - 1 ? `${word} ` : word;
      if (!text.trim()) return;
      const units = text.length;
      // Glyphs are 0.5em wide; stretch them so the word covers its box exactly.
      const hs = Math.max(0.05, w.w / (Math.max(1, units - (i < line.words.length - 1 ? 1 : 0)) * 0.5 * fs));
      page.pushOperators(setTextMatrix(hs * cos, -hs * sin, sin, cos, w.x, H - w.y), showText(PDFHexString.of(utf16Hex(text))));
    });
  }
  page.pushOperators(endText());
}
