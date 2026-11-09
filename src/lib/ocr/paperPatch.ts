// Builds the cover for an edited scanned line: the page's own pixels with the
// letters replaced by nearby paper, so the grain and tint of the scan carry on
// under the new text instead of a flat rectangle.
import { useStore, uid } from '../../state/store';
import type { PageItem, StoredImage } from '../types';
import { analyzeInk } from './ink';
import { renderPageBase } from './recognize';

/** About 216 dpi: sharp enough for print, light enough to render quickly. */
const SCALE = 3;

// The last rendered page is kept so editing several lines in a row is instant.
let cached: { key: string; canvas: Promise<HTMLCanvasElement> } | null = null;

function pageKey(page: PageItem) {
  const st = useStore.getState();
  const imgs = (st.present.annotations[page.id] ?? []).filter((a) => a.type === 'image').map((a) => JSON.stringify(a));
  return `${page.docId}:${page.srcIndex}:${page.width}x${page.height}:${imgs.join('|')}`;
}

function pageCanvas(page: PageItem) {
  const key = pageKey(page);
  if (cached?.key !== key) {
    const canvas = renderPageBase(page, SCALE);
    cached = { key, canvas };
    canvas.catch(() => {
      if (cached?.key === key) cached = null;
    });
  }
  return cached.canvas;
}

/** Starts rendering the page in the background so the first edit is quick. */
export function warmPaperPatch(page: PageItem) {
  pageCanvas(page).catch(() => {});
}

/**
 * Returns the id of a stored JPEG showing the box (base space) as bare paper,
 * or null if it could not be made. `fontSize` is in points.
 */
export async function makePaperPatch(page: PageItem, box: { x: number; y: number; w: number; h: number }, fontSize: number): Promise<string | null> {
  const canvas = await pageCanvas(page);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const fontPx = fontSize * SCALE;
  const ring = Math.max(4, Math.round(fontPx * 0.25));
  // Box in pixels, plus a ring of surrounding paper to learn from.
  const bx0 = Math.floor(box.x * SCALE),
    by0 = Math.floor(box.y * SCALE);
  const bx1 = Math.ceil((box.x + box.w) * SCALE),
    by1 = Math.ceil((box.y + box.h) * SCALE);
  const X0 = Math.max(0, bx0 - ring),
    Y0 = Math.max(0, by0 - ring);
  const X1 = Math.min(canvas.width, bx1 + ring),
    Y1 = Math.min(canvas.height, by1 + ring);
  const w = X1 - X0,
    h = Y1 - Y0;
  if (bx1 - bx0 < 2 || by1 - by0 < 2 || w <= 0 || h <= 0) return null;
  const img = ctx.getImageData(X0, Y0, w, h);
  const d = img.data;
  const ink = analyzeInk(d, w, h, ring, fontPx);
  if (ink.hasInk) {
    // Each letter pixel takes the colour of a random paper pixel from the same
    // column (or the nearest columns that have paper), which keeps grain and
    // any left-to-right shading of the scan.
    const paperRows: number[][] = Array.from({ length: w }, () => []);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (!ink.mask[y * w + x]) paperRows[x].push(y);
    let seed = 1234567;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const [br, bgc, bb] = ink.bg;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const p = y * w + x;
        if (!ink.mask[p]) continue;
        let src = -1;
        for (let r = 0; r < 24 && src < 0; r++) {
          const cx = x + (r === 0 ? 0 : Math.round((rand() - 0.5) * 2 * (r * 2)));
          if (cx < 0 || cx >= w) continue;
          const col = paperRows[cx];
          if (col.length) src = col[Math.floor(rand() * col.length)] * w + cx;
        }
        if (src >= 0) {
          d[p * 4] = d[src * 4];
          d[p * 4 + 1] = d[src * 4 + 1];
          d[p * 4 + 2] = d[src * 4 + 2];
        } else {
          d[p * 4] = br;
          d[p * 4 + 1] = bgc;
          d[p * 4 + 2] = bb;
        }
        d[p * 4 + 3] = 255;
      }
    }
  }
  // Keep only the box itself.
  const out = document.createElement('canvas');
  out.width = bx1 - bx0;
  out.height = by1 - by0;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  out.getContext('2d')!.drawImage(tmp, bx0 - X0, by0 - Y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.92));
  if (!blob) return null;
  const stored: StoredImage = {
    id: uid('img'),
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime: 'image/jpeg',
    url: URL.createObjectURL(blob),
    width: out.width,
    height: out.height,
  };
  useStore.getState().addImage(stored);
  return stored.id;
}
