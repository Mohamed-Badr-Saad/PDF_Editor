// Page-level helpers shared by the editor (analysis) and the exporter (rewrite).
import { PDFArray, PDFDict, PDFDocument, PDFPage } from 'pdf-lib';
import { apply, interpretContent, invert, mul, type Glyph, type Matrix, type PageContent } from './interpret';
import { streamBytes, type FontInfo } from './fonts';
import type { FontFamily } from '../types';

/**
 * Maps base space (y up, origin bottom-left of the page as displayed with its
 * original rotation) to the page's unrotated PDF user space.
 */
export function baseMatrix(page: PDFPage): Matrix {
  const { x, y, width, height } = page.getCropBox();
  const x1 = x + width;
  const y1 = y + height;
  switch (((page.getRotation().angle % 360) + 360) % 360) {
    case 90:
      return [0, 1, -1, 0, x1, y];
    case 180:
      return [-1, 0, 0, -1, x1, y1];
    case 270:
      return [0, -1, 1, 0, x, y1];
    default:
      return [1, 0, 0, 1, x, y];
  }
}

/** Decoded page content (all content streams joined). */
export function pageContentBytes(page: PDFPage): Uint8Array {
  const contents = page.node.Contents();
  const parts: Uint8Array[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const b = streamBytes(contents.lookup(i));
      if (b) parts.push(b);
    }
  } else {
    const b = streamBytes(contents);
    if (b) parts.push(b);
  }
  const total = parts.reduce((s, p) => s + p.length + 1, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
    out[o++] = 10;
  }
  return out;
}

export function interpretPage(page: PDFPage): PageContent {
  return interpretContent(pageContentBytes(page), page.node.Resources() as PDFDict | undefined);
}

// ---------- Analysis for the editor ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextSegment {
  id: string;
  /** Glyph ids ("op.glyph") to remove when this segment is edited. */
  glyphIds: string[];
  text: string;
  box: Box;
  /** Baseline start, base space (y down). */
  originX: number;
  originY: number;
  /** Clockwise degrees in base space. */
  angle: number;
  fontSize: number;
  hScale: number;
  color: string;
  fontRes: string;
  fontName: string;
  ascent: number;
  tc: number;
  tw: number;
  fallback: { family: FontFamily; bold: boolean; italic: boolean };
  /** Characters the original font can print. */
  chars: string;
  /** Some glyphs have no known Unicode value (text may look wrong). */
  unknown: boolean;
  /** Width from the first glyph's start to the last visible glyph's end (base units). */
  advance: number;
  /** Next segment on the same line, directly to the right (for reflow). */
  next: string | null;
  /** Characters with their horizontal extent in base space (for text selection). */
  glyphBoxes: { ch: string; x0: number; x1: number }[];
}

export interface ImageTarget {
  id: string;
  op: number;
  name?: string;
  inline: boolean;
  box: Box;
  /** Unit square → base space (y up). */
  matrixBase: Matrix;
}

export interface PageAnalysis {
  segments: TextSegment[];
  images: ImageTarget[];
  fonts: Map<string, FontInfo>;
}

export function analyzePage(page: PDFPage, baseHeight: number): PageAnalysis {
  const content = interpretPage(page);
  const inv = invert(baseMatrix(page));
  const toBase = (x: number, y: number): [number, number] => {
    const [bx, by] = apply(inv, x, y);
    return [bx, baseHeight - by];
  };
  const vecToBase = (dx: number, dy: number): [number, number] => {
    const [a, b] = apply([inv[0], inv[1], inv[2], inv[3], 0, 0], dx, dy);
    return [a, -b];
  };

  // Characters each subset font has already drawn on this page.
  const seen = new Map<string, Set<string>>();
  for (const g of content.glyphs) {
    if (!g.uni) continue;
    let s = seen.get(g.font.resName);
    if (!s) seen.set(g.font.resName, (s = new Set()));
    for (const ch of g.uni) s.add(ch);
  }
  const charsFor = (f: FontInfo) => {
    const set = seen.get(f.resName) ?? new Set<string>();
    if (!f.subset) {
      // Full font: anything it can encode. Probe the printable Latin range.
      for (let c = 32; c < 0x250; c++) {
        const ch = String.fromCharCode(c);
        if (f.fromUnicode(ch) !== undefined) set.add(ch);
      }
    }
    return [...set].filter((ch) => f.fromUnicode(ch) !== undefined).join('');
  };

  const segments: TextSegment[] = [];
  let cur: Glyph[] = [];
  let curText = '';
  const flush = () => {
    if (!cur.length) return;
    const text = curText.replace(/\s+$/, '').replace(/^\s+/, '');
    if (text) segments.push(buildSegment(cur, text));
    cur = [];
    curText = '';
  };

  const buildSegment = (gl: Glyph[], text: string): TextSegment => {
    const g0 = gl[0];
    const size = Math.hypot(g0.ux, g0.uy);
    const font = g0.font;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const g of gl) {
      const s = Math.hypot(g.ux, g.uy) || 1;
      const nx = g.ux / s,
        ny = g.uy / s;
      const asc = font.ascent * s,
        desc = font.descent * s;
      for (const [px, py] of [
        [g.x0 - nx * desc, g.y0 - ny * desc],
        [g.x1 - nx * desc, g.y1 - ny * desc],
        [g.x0 + nx * asc, g.y0 + ny * asc],
        [g.x1 + nx * asc, g.y1 + ny * asc],
      ]) {
        const [bx, by] = toBase(px, py);
        minX = Math.min(minX, bx);
        maxX = Math.max(maxX, bx);
        minY = Math.min(minY, by);
        maxY = Math.max(maxY, by);
      }
    }
    const [ox, oy] = toBase(g0.x0, g0.y0);
    let lastVisible = gl[gl.length - 1];
    for (let k = gl.length - 1; k >= 0; k--) {
      if (gl[k].uni && gl[k].uni!.trim()) {
        lastVisible = gl[k];
        break;
      }
    }
    const [ex, ey] = toBase(lastVisible.x1, lastVisible.y1);
    const [upx, upy] = vecToBase(g0.ux, g0.uy);
    // Baseline direction is the up vector turned 90° clockwise (y down: (−upy, upx) → reading direction).
    const angle = (Math.atan2(upx, -upy) * 180) / Math.PI;
    return {
      id: `${g0.op}.${g0.gi}`,
      glyphIds: gl.map((g) => `${g.op}.${g.gi}`),
      text,
      box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      originX: ox,
      originY: oy,
      angle: Math.abs(angle) < 0.01 ? 0 : angle,
      fontSize: Math.round(size * 100) / 100,
      hScale: Math.round(g0.hScale * 1000) / 1000,
      color: g0.color,
      fontRes: font.resName,
      fontName: font.displayName,
      ascent: font.ascent,
      tc: g0.tc,
      tw: g0.tw,
      fallback: font.fallback,
      chars: charsFor(font),
      unknown: gl.some((g) => g.uni === undefined),
      advance: Math.hypot(ex - ox, ey - oy),
      next: null,
      glyphBoxes: gl.flatMap((g, k) => {
        const [ax] = toBase(g.x0, g.y0);
        const [bx] = toBase(g.x1, g.y1);
        const out: { ch: string; x0: number; x1: number }[] = [];
        if (k > 0) {
          const [px] = toBase(gl[k - 1].x1, gl[k - 1].y1);
          const prevCh = gl[k - 1].uni ?? '';
          // Gaps that read as spaces become selectable spaces.
          if (ax - px > 0.18 * size && !/\s$/.test(prevCh) && g.uni !== ' ') out.push({ ch: ' ', x0: px, x1: ax });
        }
        out.push({ ch: g.uni ?? '\uFFFD', x0: Math.min(ax, bx), x1: Math.max(ax, bx) });
        return out;
      }),
    };
  };

  for (const g of content.glyphs) {
    const size = Math.hypot(g.ux, g.uy);
    if (g.invisible || size < 0.5) {
      flush();
      continue;
    }
    if (cur.length) {
      const p = cur[cur.length - 1];
      const ps = Math.hypot(p.ux, p.uy);
      const sameStyle = p.font === g.font && Math.abs(size / ps - 1) < 0.05 && p.color === g.color;
      const ux = p.ux / ps,
        uy = p.uy / ps;
      const dx = uy,
        dy = -ux; // reading direction
      const vx = g.x0 - p.x1,
        vy = g.y0 - p.y1;
      const along = vx * dx + vy * dy;
      const perp = vx * ux + vy * uy;
      if (!sameStyle || Math.abs(perp) > 0.2 * ps || along < -0.4 * ps || along > 1.0 * ps) {
        flush();
      } else if (along > 0.18 * ps && !/\s$/.test(curText) && g.uni !== ' ') {
        curText += ' ';
      }
    }
    cur.push(g);
    curText += g.uni ?? '�';
  }
  flush();

  // Link segments that continue the same line, so edits can push the rest of the line along.
  for (const sg of segments) {
    if (sg.angle !== 0) continue;
    let best: TextSegment | null = null;
    for (const o of segments) {
      if (o === sg || o.angle !== 0 || Math.abs(o.originY - sg.originY) > 0.25 * sg.fontSize || o.originX <= sg.originX) continue;
      const gap = o.originX - (sg.originX + sg.advance);
      if (gap < -0.5 || gap > 1.5 * sg.fontSize) continue;
      if (!best || o.originX < best.originX) best = o;
    }
    sg.next = best?.id ?? null;
  }

  const images: ImageTarget[] = content.images.map((im) => {
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([u, v]) => toBase(...apply(im.matrix, u, v)));
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return {
      id: String(im.op),
      op: im.op,
      name: im.name,
      inline: im.inline,
      box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      matrixBase: mul(im.matrix, inv),
    };
  });

  return { segments, images, fonts: content.fonts };
}

// ---------- Source document cache ----------

const loaded = new Map<string, Promise<PDFDocument | null>>();

/** pdf-lib copy of a source document (null when it can't be read, e.g. encrypted). */
export function sourceDoc(docId: string, bytes: Uint8Array): Promise<PDFDocument | null> {
  let p = loaded.get(docId);
  if (!p) {
    p = PDFDocument.load(bytes, { updateMetadata: false }).catch(() => null);
    loaded.set(docId, p);
  }
  return p;
}
