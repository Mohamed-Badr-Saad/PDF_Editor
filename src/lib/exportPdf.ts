import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFImage,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  StandardFonts,
  beginText,
  concatTransformationMatrix,
  degrees,
  drawObject,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingRgbColor,
  setFontAndSize,
  setLineJoin,
  setTextMatrix,
  setWordSpacing,
} from 'pdf-lib';
import type { Annotation, FontFamily, ImageAnn, MarkupAnn, NoteAnn, OcrPage, PageItem, SourceDoc, StoredImage, TextAnn } from './types';
import { LINE_HEIGHT, arrowHead, arrowShaftEnd, baselineOf, fullImageBox, inkPath, usesOriginalFont } from './geometry';
import { baseMatrix, interpretPage, sourceDoc } from './content/page';
import { loadFonts, type FontInfo } from './content/fonts';
import { encodeWithFont, rewriteContent } from './content/rewrite';
import { mul, type Matrix } from './content/interpret';
import { addOcrFont, drawOcrText } from './ocr/textLayer';
import { addComments } from './pdfAnnots';
import { clip, endPath, rectangle } from 'pdf-lib';

export interface ExportInput {
  pages: PageItem[];
  annotations: Record<string, Annotation[]>;
  docs: Record<string, SourceDoc>;
  images: Record<string, StoredImage>;
  /** Original content removed per page ("op.glyph" or "op" ids). */
  removed?: Record<string, string[]>;
  /** OCR results by source page (docId:index) or page id; saved as invisible searchable text. */
  ocr?: Record<string, OcrPage>;
  /** Name used for comments that have no author yet. */
  author?: string;
  title?: string;
  /** Fallback for source files pdf-lib cannot read (e.g. encrypted): returns a PNG of the page in base space. */
  rasterize?: (docId: string, index: number) => Promise<Uint8Array>;
}

export interface ExportResult {
  bytes: Uint8Array;
  warnings: string[];
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const FONT_MAP: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  // regular, bold, italic, bold-italic
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

export async function exportPdf(input: ExportInput): Promise<ExportResult> {
  const warnings = new Set<string>();
  const out = await PDFDocument.create();
  out.setProducer('PageCraft PDF Editor');
  out.setCreator('PageCraft PDF Editor');
  if (input.title) out.setTitle(input.title);

  // Load each referenced source document once.
  const loaded = new Map<string, PDFDocument | 'raster'>();
  for (const p of input.pages) {
    if (!p.docId || loaded.has(p.docId)) continue;
    const src = input.docs[p.docId];
    const doc = await sourceDoc(p.docId, src.bytes);
    if (doc) loaded.set(p.docId, doc);
    else if (input.rasterize) {
      // pdf-lib can't read it (usually encryption): keep the look by saving pages as images.
      loaded.set(p.docId, 'raster');
      warnings.add(`"${src.name}" is encrypted, so its pages were saved as images.`);
    } else throw new Error(`"${src.name}" could not be read.`);
  }

  const fonts = new Map<StandardFonts, PDFFont>();
  const font = async (a: TextAnn) => {
    const name = FONT_MAP[a.font][(a.bold ? 1 : 0) + (a.italic ? 2 : 0)];
    let f = fonts.get(name);
    if (!f) {
      f = await out.embedFont(name);
      fonts.set(name, f);
    }
    return f;
  };
  const embedded = new Map<string, PDFImage>();
  const image = async (id: string) => {
    let img = embedded.get(id);
    if (!img) {
      const s = input.images[id];
      if (!s) return null;
      img = s.mime === 'image/png' ? await out.embedPng(s.bytes) : await out.embedJpg(s.bytes);
      embedded.set(id, img);
    }
    return img;
  };

  // Copy each source document's pages in one batch so they share fonts and
  // images instead of duplicating them per page. Repeated pages (duplicates)
  // need their own copy, so they go in later batches.
  const copies = new Map<PageItem, PDFPage>();
  const byDoc = new Map<string, PageItem[][]>();
  for (const item of input.pages) {
    const src = item.docId ? loaded.get(item.docId) : undefined;
    if (!src || src === 'raster') continue;
    const batches = byDoc.get(item.docId!) ?? [];
    let batch = batches.find((b) => !b.some((x) => x.srcIndex === item.srcIndex));
    if (!batch) batches.push((batch = []));
    batch.push(item);
    byDoc.set(item.docId!, batches);
  }
  for (const [docId, batches] of byDoc) {
    const src = loaded.get(docId) as PDFDocument;
    for (const batch of batches) {
      const pages = await out.copyPages(src, batch.map((b) => b.srcIndex));
      batch.forEach((b, i) => copies.set(b, pages[i]));
    }
  }

  let ocrFontRef: ReturnType<typeof addOcrFont> | undefined;
  for (const item of input.pages) {
    let page: PDFPage;
    const src = item.docId ? loaded.get(item.docId) : undefined;
    if (src && src !== 'raster') {
      page = copies.get(item)!;
      out.addPage(page);
    } else if (src === 'raster') {
      page = out.addPage([item.width, item.height]);
      const png = await out.embedPng(await input.rasterize!(item.docId!, item.srcIndex));
      page.drawImage(png, { x: 0, y: 0, width: item.width, height: item.height });
    } else {
      page = out.addPage([item.width, item.height]);
    }

    // Remove edited/deleted original text and images from the page content itself.
    const removed = src && src !== 'raster' ? input.removed?.[item.id] : undefined;
    if (removed?.length) {
      const content = interpretPage(page);
      const bytes = rewriteContent(content, removed);
      page.node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(bytes)));
    }

    const allAnns = input.annotations[item.id] ?? [];
    // Comments become real PDF annotations; everything else is drawn into the page.
    const comments = allAnns.filter((a): a is NoteAnn | MarkupAnn => a.type === 'note' || a.type === 'markup');
    const anns = allAnns.filter((a) => a.type !== 'note' && a.type !== 'markup');
    const ocr = input.ocr?.[item.docId ? `${item.docId}:${item.srcIndex}` : item.id];
    const removedSet = new Set(input.removed?.[item.id] ?? []);
    // Lines the user re-typed are already real text; don't duplicate them.
    const ocrLines = ocr ? ocr.lines.filter((l) => !removedSet.has(l.id)) : [];
    if (anns.length || ocrLines.length) {
      const H = item.height;
      let pageFonts: Map<string, FontInfo> | null = null;
      const fontsOf = () => (pageFonts ??= loadFonts(page.node.Resources() as PDFDict | undefined));
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...baseMatrix(page)), setLineJoin(LineJoinStyle.Round));
      for (const a of anns) {
        await drawAnnotation(page, a, H, { font, image, warn: (w) => warnings.add(w), pageFonts: fontsOf, original: src !== 'raster' && !!src });
      }
      if (ocrLines.length) {
        ocrFontRef ??= addOcrFont(out);
        drawOcrText(page, ocrFontRef, ocrLines, H);
      }
      page.pushOperators(popGraphicsState());
    }

    if (comments.length) addComments(out, page, comments, item.height, baseMatrix(page), input.author);

    const finalRotation = (page.getRotation().angle + item.rotation) % 360;
    page.setRotation(degrees(finalRotation));
  }

  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, warnings: [...warnings] };
}

interface DrawCtx {
  font(a: TextAnn): Promise<PDFFont>;
  image(id: string): Promise<PDFImage | null>;
  warn(msg: string): void;
  pageFonts(): Map<string, FontInfo>;
  /** The page is a real copy of the source (not a raster fallback), so its resources exist. */
  original: boolean;
}

/** Writes text with the document's own font. Returns false if it can't. */
function drawWithOriginalFont(page: PDFPage, a: TextAnn, H: number, ctx: DrawCtx): boolean {
  if (!a.source || !ctx.original || !usesOriginalFont(a)) return false;
  const font = ctx.pageFonts().get(a.source.fontRes);
  if (!font) return false;
  const lines = a.text.split('\n');
  const encoded = lines.map((l) => encodeWithFont(font, l, a.source!.chars + ' '));
  if (encoded.some((e) => e === null)) return false;
  const rad = (a.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const fs = a.fontSize;
  const hs = a.source.hScale || 1;
  const c = hexToRgb(a.color);
  page.pushOperators(beginText(), setFontAndSize(PDFName.of(a.source.fontRes), 1), setCharacterSpacing(a.source.tc), setWordSpacing(a.source.tw));
  page.pushOperators(setFillingRgbColor(c.red, c.green, c.blue));
  lines.forEach((_, i) => {
    const els = encoded[i]!;
    if (!els.length) return;
    const oy = fs * (baselineOf(a) + i * LINE_HEIGHT);
    const bx = a.x - oy * sin;
    const by = a.y + oy * cos;
    // Base space is y-up here, so a clockwise angle becomes a negative rotation.
    page.pushOperators(setTextMatrix(fs * hs * cos, -fs * hs * sin, fs * sin, fs * cos, bx, H - by));
    const arr = PDFArray.withContext(page.doc.context);
    for (const e of els) arr.push(typeof e === 'number' ? PDFNumber.of(e) : PDFHexString.of([...e].map((b) => b.toString(16).padStart(2, '0')).join('')));
    page.pushOperators(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [arr]));
  });
  page.pushOperators(endText());
  return true;
}

/** Re-draws an image from the original file at its new position, without re-encoding it. */
function drawOriginalImage(page: PDFPage, a: ImageAnn, H: number, ctx: DrawCtx): boolean {
  const src = a.source;
  if (!src?.name || !ctx.original) return false;
  const b0 = src.box0;
  if (!b0.w || !b0.h) return false;
  // The full picture's new box (bigger than the visible box when cropped).
  const full = fullImageBox(a);
  const sx = full.w / b0.w;
  const sy = full.h / b0.h;
  const X0 = b0.x;
  const Y0 = H - b0.y - b0.h;
  const X1 = full.x;
  const Y1 = H - full.y - full.h;
  const S: Matrix = [sx, 0, 0, sy, X1 - sx * X0, Y1 - sy * Y0];
  const m = mul(src.matrixBase as Matrix, S);
  page.pushOperators(pushGraphicsState());
  if (a.crop) page.pushOperators(rectangle(a.x, H - a.y - a.h, a.w, a.h), clip(), endPath());
  page.pushOperators(concatTransformationMatrix(...m), drawObject(src.name), popGraphicsState());
  return true;
}

async function drawAnnotation(page: PDFPage, a: Annotation, H: number, ctx: DrawCtx) {
  const opacity = a.opacity ?? 1;
  switch (a.type) {
    case 'text': {
      if (drawWithOriginalFont(page, a, H, ctx)) break;
      const f = await ctx.font(a);
      const supported = new Set(f.getCharacterSet());
      const color = hexToRgb(a.color);
      const rad = (a.angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const lines = a.text.split('\n');
      lines.forEach((raw, i) => {
        let line = '';
        for (const ch of raw) {
          const cp = ch.codePointAt(0)!;
          if (supported.has(cp)) line += ch;
          else {
            line += '?';
            ctx.warn('Some characters (for example Arabic or emoji) are not supported by the built-in fonts yet and were replaced with "?".');
          }
        }
        if (!line.trim()) return;
        // Baseline offset inside the (possibly rotated) text box, y down.
        const oy = a.fontSize * (baselineOf(a) + i * LINE_HEIGHT);
        const bx = a.x - oy * sin;
        const by = a.y + oy * cos;
        page.drawText(line, {
          x: bx,
          y: H - by,
          size: a.fontSize,
          font: f,
          color,
          opacity,
          rotate: degrees(-a.angle),
        });
      });
      break;
    }
    case 'ink': {
      const d = inkPath(a.points);
      if (!d) break;
      page.drawSvgPath(d, {
        x: 0,
        y: H,
        borderColor: hexToRgb(a.color),
        borderWidth: a.width,
        borderOpacity: opacity,
        borderLineCap: LineCapStyle.Round,
        blendMode: a.highlighter ? BlendMode.Multiply : undefined,
      });
      break;
    }
    case 'rect':
    case 'highlight':
    case 'whiteout': {
      const fill = a.fill ? hexToRgb(a.fill) : undefined;
      const stroke = a.stroke && a.strokeWidth > 0 ? hexToRgb(a.stroke) : undefined;
      page.drawRectangle({
        x: a.x,
        y: H - a.y - a.h,
        width: a.w,
        height: a.h,
        color: fill,
        opacity: fill ? opacity : undefined,
        borderColor: stroke,
        borderWidth: stroke ? a.strokeWidth : 0,
        borderOpacity: stroke ? opacity : undefined,
        blendMode: a.type === 'highlight' ? BlendMode.Multiply : undefined,
      });
      break;
    }
    case 'ellipse': {
      const fill = a.fill ? hexToRgb(a.fill) : undefined;
      const stroke = a.stroke && a.strokeWidth > 0 ? hexToRgb(a.stroke) : undefined;
      page.drawEllipse({
        x: a.x + a.w / 2,
        y: H - (a.y + a.h / 2),
        xScale: a.w / 2,
        yScale: a.h / 2,
        color: fill,
        opacity: fill ? opacity : undefined,
        borderColor: stroke,
        borderWidth: stroke ? a.strokeWidth : 0,
        borderOpacity: stroke ? opacity : undefined,
      });
      break;
    }
    case 'line':
    case 'arrow': {
      const color = hexToRgb(a.color);
      const [ex, ey] = a.type === 'arrow' ? arrowShaftEnd(a) : [a.x2, a.y2];
      page.drawLine({
        start: { x: a.x1, y: H - a.y1 },
        end: { x: ex, y: H - ey },
        thickness: a.width,
        color,
        opacity,
        lineCap: LineCapStyle.Round,
      });
      if (a.type === 'arrow') {
        page.drawSvgPath(arrowHead(a), { x: 0, y: H, color, opacity, borderWidth: 0 });
      }
      break;
    }
    case 'image': {
      if (drawOriginalImage(page, a, H, ctx)) break;
      const img = await ctx.image(a.imageId);
      if (!img) break;
      const full = fullImageBox(a);
      if (a.crop) page.pushOperators(pushGraphicsState(), rectangle(a.x, H - a.y - a.h, a.w, a.h), clip(), endPath());
      page.drawImage(img, { x: full.x, y: H - full.y - full.h, width: full.w, height: full.h, opacity });
      if (a.crop) page.pushOperators(popGraphicsState());
      break;
    }
  }
}

/** Builds a PDF that contains only the given pages (used by "Extract pages"). */
export async function exportSubset(input: ExportInput, pageIds: string[]): Promise<ExportResult> {
  const ids = new Set(pageIds);
  return exportPdf({ ...input, pages: input.pages.filter((p) => ids.has(p.id)) });
}
