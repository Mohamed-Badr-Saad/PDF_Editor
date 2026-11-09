// Pixel analysis of a scanned text line: paper colour, ink colour, which pixels
// are ink, and how heavy the strokes are. Shared by OCR (to style edited text
// like the original) and by the paper patch that hides the old words.

export interface InkAnalysis {
  /** Paper colour around the line. */
  bg: [number, number, number];
  /** Colour of the letter strokes. */
  fg: [number, number, number];
  /** 1 where a pixel belongs to a letter (grown a little to swallow soft edges). */
  mask: Uint8Array;
  /** Typical stroke thickness divided by the font size (≈0.08 regular, ≈0.14 bold). */
  stroke: number;
  /** False when the box holds no clear ink (nothing to hide or style). */
  hasInk: boolean;
}

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

function median(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Analyses `w×h` RGBA pixels. Pixels within `ring` of the edge are treated as
 * paper (the caller pads the text box by that much). `fontPx` is the font size
 * in pixels, used to judge stroke weight and how far to grow the ink mask.
 */
export function analyzeInk(d: Uint8ClampedArray, w: number, h: number, ring: number, fontPx: number): InkAnalysis {
  const n = w * h;
  const L = new Float32Array(n);
  for (let p = 0; p < n; p++) L[p] = lum(d, p * 4);

  // Paper: median of the outer ring; its spread tells how grainy the scan is.
  const ringIdx: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) ringIdx.push(y * w + x);
  const ringL = ringIdx.map((p) => L[p]);
  const bgL = median(ringL);
  const noise = 1.4826 * median(ringL.map((v) => Math.abs(v - bgL)));
  // Use only paper-like ring pixels for the colour, so a stray mark doesn't tint it.
  const paper = ringIdx.filter((p) => Math.abs(L[p] - bgL) <= Math.max(6, 2.5 * noise));
  const ch = (k: number) => median(paper.map((p) => d[p * 4 + k]));
  const bg: [number, number, number] = paper.length ? [ch(0), ch(1), ch(2)] : [255, 255, 255];

  // Darkest ink: 2nd percentile of the inside.
  const inside: number[] = [];
  for (let y = ring; y < h - ring; y++) for (let x = ring; x < w - ring; x++) inside.push(L[y * w + x]);
  inside.sort((a, b) => a - b);
  const inkL = inside.length ? inside[Math.floor(inside.length * 0.02)] : bgL;
  const contrast = bgL - inkL;
  const mask = new Uint8Array(n);
  if (contrast < Math.max(20, 4 * noise)) return { bg, fg: [0, 0, 0], mask, stroke: 0, hasInk: false };

  // Ink core: clearly darker than paper (well outside the grain).
  const core = bgL - Math.max(4 * noise + 8, contrast * 0.45);
  const coreIdx: number[] = [];
  for (let p = 0; p < n; p++) if (L[p] < core) coreIdx.push(p);
  // Ink colour: the darker half of the core pixels (stroke centres, not soft edges).
  coreIdx.sort((a, b) => L[a] - L[b]);
  const dark = coreIdx.slice(0, Math.max(1, Math.ceil(coreIdx.length / 2)));
  const fch = (k: number) => median(dark.map((p) => d[p * 4 + k]));
  const fg: [number, number, number] = [fch(0), fch(1), fch(2)];

  // Stroke weight: median length of horizontal runs of core pixels.
  const runs: number[] = [];
  for (let y = ring; y < h - ring; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (L[y * w + x] < core) run++;
      else if (run) {
        runs.push(run);
        run = 0;
      }
    }
    if (run) runs.push(run);
  }
  const stroke = fontPx > 0 ? median(runs.filter((r) => r > 1)) / fontPx : 0;

  // Mask = anything visibly darker than paper, grown to cover anti-aliased edges.
  const soft = bgL - Math.max(3 * noise + 6, contrast * 0.18);
  const seed = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (L[p] < soft) seed[p] = 1;
  const grow = Math.max(1, Math.round(fontPx * 0.05));
  // Separable dilation (rows, then columns).
  const tmp = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (seed[y * w + x]) last = x;
      if (x - last <= grow) tmp[y * w + x] = 1;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (seed[y * w + x]) last = x;
      if (last - x <= grow) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= grow) mask[y * w + x] = 1;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= grow) mask[y * w + x] = 1;
    }
  }
  return { bg, fg, mask, stroke, hasInk: true };
}

export const toHex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
