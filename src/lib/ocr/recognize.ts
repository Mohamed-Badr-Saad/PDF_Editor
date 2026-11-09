// Runs Tesseract (WebAssembly) on page images, entirely in the browser.
import { useStore, ocrKey } from '../../state/store';
import { displaySize, displayToBase } from '../geometry';
import { getPdf } from '../pdf';
import type { ImageAnn, OcrLine, OcrPage, OcrWord, PageItem } from '../types';

export type OcrLang = 'eng' | 'ara' | 'eng+ara';

export const OCR_LANGS: { id: OcrLang; label: string }[] = [
  { id: 'eng', label: 'English' },
  { id: 'ara', label: 'Arabic (العربية)' },
  { id: 'eng+ara', label: 'English + Arabic' },
];

const DPI = 300;
const MAX_SIDE = 5200;

/** Renders a page as shown (editor rotation applied) for recognition. */
async function renderForOcr(page: PageItem): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const scale = Math.min(DPI / 72, MAX_SIDE / Math.max(page.width, page.height));
  const base = document.createElement('canvas');
  base.width = Math.round(page.width * scale);
  base.height = Math.round(page.height * scale);
  const ctx = base.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, base.width, base.height);
  if (page.docId) {
    const pdf = await getPdf(page.docId);
    if (pdf) {
      const p = await pdf.getPage(page.srcIndex + 1);
      const vp = p.getViewport({ scale });
      await p.render({ canvas: base, viewport: vp }).promise;
    }
  }
  // Pictures placed on the page (e.g. photos turned into pages).
  const st = useStore.getState();
  for (const a of st.present.annotations[page.id] ?? []) {
    if (a.type !== 'image') continue;
    const img = st.images[(a as ImageAnn).imageId];
    if (!img) continue;
    const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart], { type: img.mime }));
    ctx.globalAlpha = a.opacity;
    ctx.drawImage(bmp, a.x * scale, a.y * scale, a.w * scale, a.h * scale);
    ctx.globalAlpha = 1;
    bmp.close();
  }
  if (!page.rotation) return { canvas: base, scale };
  // Turn it the way the user sees it, so the text is upright for Tesseract.
  const d = displaySize(page);
  const out = document.createElement('canvas');
  out.width = Math.round(d.width * scale);
  out.height = Math.round(d.height * scale);
  const o = out.getContext('2d')!;
  o.translate(out.width / 2, out.height / 2);
  o.rotate((page.rotation * Math.PI) / 180);
  o.drawImage(base, -base.width / 2, -base.height / 2);
  return { canvas: out, scale };
}

// ---------- colour sampling ----------

function hex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Paper colour = median of the border around the box; ink = average of its darkest pixels. */
function sampleColors(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): { bg: string; fg: string } {
  const pad = 3;
  const X0 = Math.max(0, Math.floor(x0 - pad));
  const Y0 = Math.max(0, Math.floor(y0 - pad));
  const X1 = Math.min(ctx.canvas.width, Math.ceil(x1 + pad));
  const Y1 = Math.min(ctx.canvas.height, Math.ceil(y1 + pad));
  const w = X1 - X0,
    h = Y1 - Y0;
  if (w <= 0 || h <= 0) return { bg: '#ffffff', fg: '#000000' };
  const d = ctx.getImageData(X0, Y0, w, h).data;
  const border: number[][] = [];
  const inner: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = [d[i], d[i + 1], d[i + 2]];
      if (x < pad || y < pad || x >= w - pad || y >= h - pad) border.push(px);
      else inner.push(px);
    }
  }
  const lum = (p: number[]) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  const median = (arr: number[][], k: number) => {
    const v = arr.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 255;
  };
  const bg = border.length ? [median(border, 0), median(border, 1), median(border, 2)] : [255, 255, 255];
  inner.sort((a, b) => lum(a) - lum(b));
  const dark = inner.slice(0, Math.max(1, Math.floor(inner.length * 0.12)));
  const fg = dark.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map((v) => v / dark.length);
  return { bg: hex(bg[0], bg[1], bg[2]), fg: hex(fg[0], fg[1], fg[2]) };
}

// ---------- recognition ----------

export interface OcrProgress {
  pageIndex: number;
  pageCount: number;
  /** 0..1 within the current page. */
  progress: number;
  status: string;
}

type TessWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

export interface OcrRun {
  promise: Promise<{ pages: number; lines: number }>;
  cancel(): void;
}

/** Recognises text on the given pages and stores the results in the editor. */
export function runOcr(pages: PageItem[], lang: OcrLang, onProgress: (p: OcrProgress) => void): OcrRun {
  let worker: TessWorker | null = null;
  let cancelled = false;
  let current = 0;
  const promise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = new URL('tesseract/', document.baseURI).href;
    onProgress({ pageIndex: 0, pageCount: pages.length, progress: 0, status: 'Loading the OCR engine…' });
    worker = await createWorker(lang.split('+'), OEM.LSTM_ONLY, {
      workerPath: base + 'worker.min.js',
      corePath: base + 'core',
      langPath: base + 'lang',
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text') onProgress({ pageIndex: current, pageCount: pages.length, progress: m.progress, status: 'Reading text…' });
      },
    });
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: String(DPI) });
    let total = 0;
    for (let i = 0; i < pages.length; i++) {
      if (cancelled) break;
      current = i;
      const page = pages[i];
      onProgress({ pageIndex: i, pageCount: pages.length, progress: 0, status: 'Preparing page…' });
      const { canvas, scale } = await renderForOcr(page);
      if (cancelled) break;
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      const result = toOcrPage(data, canvas, scale, page, lang);
      total += result.lines.length;
      useStore.getState().setOcr(ocrKey(page), result);
    }
    return { pages: pages.length, lines: total };
  })().finally(() => {
    (worker as TessWorker | null)?.terminate().catch(() => {});
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      (worker as TessWorker | null)?.terminate().catch(() => {});
    },
  };
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

interface TBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function toOcrPage(data: unknown, canvas: HTMLCanvasElement, scale: number, page: PageItem, lang: string): OcrPage {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const lines: OcrLine[] = [];
  const blocks = (data as { blocks?: { paragraphs: { lines: unknown[] }[] }[] }).blocks ?? [];
  // Pixels in the upright (display) image → base space.
  const toBase = (px: number, py: number) => displayToBase(px / scale, py / scale, page);
  let n = 0;
  for (const b of blocks) {
    for (const para of b.paragraphs) {
      for (const raw of para.lines) {
        const l = raw as { text: string; confidence: number; bbox: TBox; baseline: TBox; words: { text: string; bbox: TBox; confidence: number }[] };
        const text = l.text.replace(/\s+/g, ' ').trim();
        if (!text || l.confidence < 35 || !l.words?.length) continue;
        const bl = l.baseline && l.baseline.x1 !== l.baseline.x0 ? l.baseline : { x0: l.bbox.x0, y0: l.bbox.y1, x1: l.bbox.x1, y1: l.bbox.y1 };
        const slope = (bl.y1 - bl.y0) / (bl.x1 - bl.x0 || 1);
        const baseAt = (x: number) => bl.y0 + slope * (x - bl.x0);
        const heightPx = l.bbox.y1 - l.bbox.y0;
        let fsPx = (baseAt(l.bbox.x0) - l.bbox.y0) / 0.72;
        if (!isFinite(fsPx) || fsPx < heightPx * 0.6 || fsPx > heightPx * 1.6) fsPx = heightPx * 0.95;
        const displayAngle = (Math.atan(slope) * 180) / Math.PI;
        const words: OcrWord[] = l.words
          .filter((w) => w.text.trim())
          .map((w) => {
            const [x, y] = toBase(w.bbox.x0, baseAt(w.bbox.x0));
            return { text: w.text.trim(), x, y, w: (w.bbox.x1 - w.bbox.x0) / scale };
          });
        const [x, y] = toBase(l.bbox.x0, baseAt(l.bbox.x0));
        const corners = [
          toBase(l.bbox.x0, l.bbox.y0),
          toBase(l.bbox.x1, l.bbox.y0),
          toBase(l.bbox.x0, l.bbox.y1),
          toBase(l.bbox.x1, l.bbox.y1),
        ];
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const colors = sampleColors(ctx, l.bbox.x0, l.bbox.y0, l.bbox.x1, l.bbox.y1);
        lines.push({
          id: `ocr:${n++}`,
          text,
          words,
          x,
          y,
          angle: Math.round((displayAngle - page.rotation) * 100) / 100,
          fontSize: Math.round((fsPx / scale) * 10) / 10,
          box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
          bg: colors.bg,
          fg: colors.fg,
          confidence: Math.round(l.confidence),
          rtl: RTL.test(text),
        });
      }
    }
  }
  return { lang, lines };
}

/** Plain text of OCR results, page by page. */
export function ocrPlainText(pages: PageItem[]): string {
  const st = useStore.getState();
  return pages
    .map((p, i) => {
      const r = st.ocr[ocrKey(p)];
      if (!r) return null;
      return `--- Page ${st.present.pages.indexOf(p) + 1 || i + 1} ---\n${r.lines.map((l) => l.text).join('\n')}`;
    })
    .filter(Boolean)
    .join('\n\n');
}
