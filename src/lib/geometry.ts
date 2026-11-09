import type { Annotation, FontFamily, PageItem, Rotation, TextAnn } from './types';

/** Size of the page as displayed (after editor rotation). */
export function displaySize(p: PageItem): { width: number; height: number } {
  return p.rotation % 180 === 0 ? { width: p.width, height: p.height } : { width: p.height, height: p.width };
}

/** Maps a point in display space (points, y down) to base space. */
export function displayToBase(x: number, y: number, p: PageItem): [number, number] {
  switch (p.rotation) {
    case 90:
      return [y, p.height - x];
    case 180:
      return [p.width - x, p.height - y];
    case 270:
      return [p.width - y, x];
    default:
      return [x, y];
  }
}

/** Maps a point in base space to display space (inverse of displayToBase). */
export function baseToDisplay(x: number, y: number, p: PageItem): [number, number] {
  switch (p.rotation) {
    case 90:
      return [p.height - y, x];
    case 180:
      return [p.width - x, p.height - y];
    case 270:
      return [y, p.width - x];
    default:
      return [x, y];
  }
}

/** Size of the note icon in points. */
export const NOTE_SIZE = 18;

export function normalizeRotation(deg: number): Rotation {
  return ((((deg % 360) + 360) % 360) as Rotation);
}

// ---------- Text metrics ----------

/** CSS font stacks that visually match the PDF standard 14 fonts. */
export const cssFontFamily: Record<FontFamily, string> = {
  Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  Times: '"Times New Roman", Times, "Liberation Serif", serif',
  Courier: '"Courier New", Courier, "Liberation Mono", monospace',
};

/** Web font with the same file used when saving, so the editor matches the PDF. */
export const UNICODE_FONT = '"PageCraft Arabic"';

// Characters the 14 standard PDF fonts (WinAnsi) can print.
const WIN_ANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
/** True when text needs the bundled Unicode font (Arabic, Hebrew, Greek…). */
export function needsUnicodeFont(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN_ANSI_EXTRA.has(ch)) continue;
    return true;
  }
  return false;
}

/** CSS font stack for a text item (the Unicode font first when it will be used to save). */
export function fontStackOf(a: { font: FontFamily; text: string }): string {
  return needsUnicodeFont(a.text) ? `${UNICODE_FONT}, ${cssFontFamily[a.font]}` : cssFontFamily[a.font];
}

export const LINE_HEIGHT = 1.2;
/** Distance from the top of a line box to the baseline, as a fraction of font size. */
export const BASELINE: Record<FontFamily, number> = { Helvetica: 0.93, Times: 0.92, Courier: 0.87 };

/** Baseline position (fraction of font size from the top of the line box). */
export function baselineOf(a: Pick<TextAnn, 'font' | 'source'>): number {
  return a.source ? a.source.ascent : BASELINE[a.font];
}

/** True when this text can be written with the document's original font. */
export function usesOriginalFont(a: TextAnn): boolean {
  const s = a.source;
  if (!s?.useOriginal) return false;
  for (const ch of a.text) if (ch !== '\n' && ch !== ' ' && !s.chars.includes(ch)) return false;
  return true;
}

let measureCtx: CanvasRenderingContext2D | null = null;

export function cssFont(a: Pick<TextAnn, 'font' | 'fontSize' | 'bold' | 'italic'> & { text?: string }, size = a.fontSize) {
  const stack = a.text !== undefined ? fontStackOf({ font: a.font, text: a.text }) : cssFontFamily[a.font];
  return `${a.italic ? 'italic ' : ''}${a.bold ? 'bold ' : ''}${size}px ${stack}`;
}

export function measureText(a: Pick<TextAnn, 'font' | 'fontSize' | 'bold' | 'italic' | 'text'> & { source?: TextAnn['source'] }): { w: number; h: number } {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const lines = a.text.split('\n');
  let w = 0;
  if (measureCtx) {
    // Measure at 100px and scale for sub-pixel accuracy.
    measureCtx.font = cssFont(a, 100);
    for (const line of lines) w = Math.max(w, (measureCtx.measureText(line).width * a.fontSize) / 100);
  } else {
    w = Math.max(...lines.map((l) => l.length)) * a.fontSize * 0.55;
  }
  if (a.source) w *= a.source.hScale || 1;
  return { w: Math.max(w, a.fontSize * 0.5), h: lines.length * a.fontSize * LINE_HEIGHT };
}

// ---------- Bounding boxes ----------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function annBox(a: Annotation): Box {
  switch (a.type) {
    case 'text': {
      const { w, h } = measureText(a);
      if (!a.angle) return { x: a.x, y: a.y, w, h };
      const rad = (a.angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const pts = [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ].map(([dx, dy]) => [a.x + dx * cos - dy * sin, a.y + dx * sin + dy * cos]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'ink': {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (let i = 0; i < a.points.length; i += 2) {
        minX = Math.min(minX, a.points[i]);
        maxX = Math.max(maxX, a.points[i]);
        minY = Math.min(minY, a.points[i + 1]);
        maxY = Math.max(maxY, a.points[i + 1]);
      }
      const pad = a.width / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + a.width, h: maxY - minY + a.width };
    }
    case 'line':
    case 'arrow': {
      const pad = a.width / 2 + (a.type === 'arrow' ? a.width * 2 : 0);
      return {
        x: Math.min(a.x1, a.x2) - pad,
        y: Math.min(a.y1, a.y2) - pad,
        w: Math.abs(a.x2 - a.x1) + pad * 2,
        h: Math.abs(a.y2 - a.y1) + pad * 2,
      };
    }
    case 'note':
      return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE };
    case 'markup': {
      const xs = a.quads.flatMap((q) => [q.x, q.x + q.w]);
      const ys = a.quads.flatMap((q) => [q.y, q.y + q.h]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

/** Items anchored to text can't be dragged or resized. */
export const isAnchored = (a: Annotation) => a.type === 'markup';

/** Returns a copy of `a` moved by (dx, dy). */
export function moveAnn<T extends Annotation>(a: T, dx: number, dy: number): T {
  switch (a.type) {
    case 'ink':
      return { ...a, points: a.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
    case 'line':
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'markup':
      return { ...a, quads: a.quads.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })) };
    default:
      return { ...a, x: (a as { x: number }).x + dx, y: (a as { y: number }).y + dy };
  }
}

/** Scales an annotation so that its box `from` becomes `to`. */
export function resizeAnn<T extends Annotation>(a: T, from: Box, to: Box): T {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (x: number) => to.x + (x - from.x) * sx;
  const my = (y: number) => to.y + (y - from.y) * sy;
  switch (a.type) {
    case 'ink':
      return { ...a, points: a.points.map((v, i) => (i % 2 === 0 ? mx(v) : my(v))) };
    case 'line':
    case 'arrow':
      return { ...a, x1: mx(a.x1), y1: my(a.y1), x2: mx(a.x2), y2: my(a.y2) };
    case 'text': {
      // Text scales by font size, uniformly.
      // Text scales uniformly around the fixed corner (works for rotated text too).
      const s = Math.max(0.05, sx);
      const fx = to.x + (a.x - from.x) * s;
      const fy = to.y + (a.y - from.y) * s;
      return { ...a, x: fx, y: fy, fontSize: Math.max(4, Math.round(a.fontSize * s * 10) / 10) };
    }
    case 'note':
    case 'markup':
      return a;
    default:
      return { ...a, x: to.x, y: to.y, w: Math.max(2, to.w), h: Math.max(2, to.h) };
  }
}

/** Full (uncropped) box of an image annotation. */
export function fullImageBox(a: { x: number; y: number; w: number; h: number; crop?: { x: number; y: number; w: number; h: number } }) {
  const c = a.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const fw = a.w / c.w;
  const fh = a.h / c.h;
  return { x: a.x - c.x * fw, y: a.y - c.y * fh, w: fw, h: fh };
}

/** Builds a smoothed SVG path from a flat point list. */
export function inkPath(points: number[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${points[0]} ${points[1]} L${points[0] + 0.01} ${points[1]}`;
  // Quadratic smoothing through midpoints.
  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2;
    const my = (points[i + 1] + points[i + 3]) / 2;
    d += ` Q${points[i]} ${points[i + 1]} ${mx} ${my}`;
  }
  const n = points.length;
  d += ` L${points[n - 2]} ${points[n - 1]}`;
  return d;
}

export function arrowHead(a: { x1: number; y1: number; x2: number; y2: number; width: number }): string {
  const len = Math.max(8, a.width * 4);
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const spread = Math.PI / 7;
  const p1 = [a.x2 - len * Math.cos(ang - spread), a.y2 - len * Math.sin(ang - spread)];
  const p2 = [a.x2 - len * Math.cos(ang + spread), a.y2 - len * Math.sin(ang + spread)];
  return `M${a.x2} ${a.y2} L${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} Z`;
}

/** Shortens the arrow shaft so it doesn't poke through the head. */
export function arrowShaftEnd(a: { x1: number; y1: number; x2: number; y2: number; width: number }): [number, number] {
  const len = Math.max(8, a.width * 4) * 0.8;
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const total = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const l = Math.min(len, total);
  return [a.x2 - l * Math.cos(ang), a.y2 - l * Math.sin(ang)];
}

/** Simplifies a freehand stroke (Ramer–Douglas–Peucker) to keep files small. */
export function simplify(points: number[], tolerance = 0.6): number[] {
  if (points.length <= 4) return points;
  const pts: [number, number][] = [];
  for (let i = 0; i < points.length; i += 2) pts.push([points[i], points[i + 1]]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0,
      idx = -1;
    const [x1, y1] = pts[s];
    const [x2, y2] = pts[e];
    const dx = x2 - x1,
      dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  pts.forEach((p, i) => keep[i] && out.push(Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100));
  return out;
}
