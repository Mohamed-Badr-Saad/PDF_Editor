// Runs Tesseract (WebAssembly) on page images, entirely in the browser.
import { useStore, ocrKey } from '../../state/store';
import { displaySize, displayToBase } from '../geometry';
import { getPdf } from '../pdf';
import { analyzeInk, toHex } from './ink';
import type { ImageAnn, OcrLine, OcrPage, OcrWord, PageItem } from '../types';

export type OcrLang = 'auto' | 'eng' | 'ara';

export const OCR_LANGS: { id: OcrLang; label: string }[] = [
  { id: 'auto', label: 'Automatic (English and Arabic)' },
  { id: 'eng', label: 'English only' },
  { id: 'ara', label: 'Arabic only (العربية)' },
];

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN = /[A-Za-z]/g;
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

function overlap(a: OcrLine['box'], b: OcrLine['box']) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / Math.max(1e-6, Math.min(a.w * a.h, b.w * b.h));
}

/**
 * Mixed English+Arabic recognition sometimes turns Arabic words into Latin
 * junk. On mostly-Arabic pages, prefer an Arabic-only reading line by line,
 * keeping lines that are clearly real English.
 */
function mergeReadings(mixed: OcrLine[], arabic: OcrLine[]): OcrLine[] {
  const used = new Set<OcrLine>();
  const out: OcrLine[] = [];
  for (const m of mixed) {
    const latin = count(m.text, LATIN);
    const arab = count(m.text, ARABIC);
    const clearlyEnglish = latin > arab * 2 && m.confidence >= 80;
    const match = arabic.filter((a) => !used.has(a) && overlap(a.box, m.box) > 0.5).sort((x, y) => overlap(y.box, m.box) - overlap(x.box, m.box))[0];
    if (match && !clearlyEnglish) {
      used.add(match);
      out.push(match);
    } else out.push(m);
  }
  // Arabic lines the mixed reading missed entirely.
  for (const a of arabic) if (!used.has(a) && count(a.text, ARABIC) > 0 && !out.some((o) => overlap(o.box, a.box) > 0.3)) out.push(a);
  out.sort((a, b) => a.box.y - b.box.y);
  return out.map((l, i) => ({ ...l, id: `ocr:${i}` }));
}

const DPI = 300;
const MAX_SIDE = 5200;

/** Renders a page as shown (editor rotation applied) for recognition. */
async function renderForOcr(page: PageItem): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const scale = Math.min(DPI / 72, MAX_SIDE / Math.max(page.width, page.height));
  const base = await renderPageBase(page, scale);
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

/** The page's own content plus placed pictures, unrotated (base space × scale). */
export async function renderPageBase(page: PageItem, scale: number): Promise<HTMLCanvasElement> {
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
  return base;
}

// ---------- styling from the scan ----------

/** Paper colour, ink colour and weight of the text inside a pixel box. */
function sampleStyle(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, fontPx: number) {
  const pad = Math.max(3, Math.round(fontPx * 0.15));
  const X0 = Math.max(0, Math.floor(x0 - pad));
  const Y0 = Math.max(0, Math.floor(y0 - pad));
  const X1 = Math.min(ctx.canvas.width, Math.ceil(x1 + pad));
  const Y1 = Math.min(ctx.canvas.height, Math.ceil(y1 + pad));
  const w = X1 - X0,
    h = Y1 - Y0;
  if (w <= pad * 2 || h <= pad * 2) return { bg: '#ffffff', fg: '#000000', bold: false, stroke: 0 };
  const r = analyzeInk(ctx.getImageData(X0, Y0, w, h).data, w, h, pad, fontPx);
  return { bg: toHex(r.bg), fg: r.hasInk ? toHex(r.fg) : '#000000', bold: r.stroke >= BOLD_STROKE, stroke: Math.round(r.stroke * 1000) / 1000 };
}

/** Stroke thickness / font size above which text counts as bold. */
const BOLD_STROKE = 0.127;

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
  promise: Promise<{ pages: number; lines: number; hardPages: string[] }>;
  cancel(): void;
}

/** Recognises text on the given pages and stores the results in the editor. */
export function runOcr(pages: PageItem[], lang: OcrLang, onProgress: (p: OcrProgress) => void): OcrRun {
  const workers: TessWorker[] = [];
  let cancelled = false;
  let current = 0;
  let phase = 0; // 0..1 share of the current page already done
  const promise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = new URL('tesseract/', document.baseURI).href;
    const make = async (langs: string[]) => {
      const w = await createWorker(langs, OEM.LSTM_ONLY, {
        workerPath: base + 'worker.min.js',
        corePath: base + 'core',
        langPath: base + 'lang',
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text')
            onProgress({ pageIndex: current, pageCount: pages.length, progress: Math.min(1, phase + m.progress * (lang === 'auto' || phase > 0 ? 0.5 : 1)), status: 'Reading text…' });
        },
      });
      // preserve_interword_spaces would glue Arabic words together, so it stays off.
      await w.setParameters({ user_defined_dpi: String(DPI) });
      workers.push(w);
      return w;
    };
    onProgress({ pageIndex: 0, pageCount: pages.length, progress: 0, status: 'Loading the OCR engine…' });
    const main = await make(lang === 'auto' ? ['eng', 'ara'] : [lang]);
    let arabicOnly: TessWorker | null = null;
    let englishOnly: TessWorker | null = null;
    let total = 0;
    const hardPages: number[] = [];
    for (let i = 0; i < pages.length; i++) {
      if (cancelled) break;
      current = i;
      phase = 0;
      const page = pages[i];
      onProgress({ pageIndex: i, pageCount: pages.length, progress: 0, status: 'Preparing page…' });
      const { canvas, scale } = await renderForOcr(page);
      if (cancelled) break;
      const { data } = await main.recognize(canvas, {}, { blocks: true, text: true });
      let result = toOcrPage(data, canvas, scale, page, lang);
      let confidence = (data as { confidence: number }).confidence;
      let arabicReading: OcrPage | null = null;
      // Safety net: a page read in the wrong language comes back as low-confidence junk.
      // Try the other language and keep whichever reading is more confident.
      if (confidence < 60) {
        phase = 0.5;
        const altLang = lang === 'ara' ? 'eng' : 'ara';
        const alt = altLang === 'ara' ? (arabicOnly ??= await make(['ara'])) : (englishOnly ??= await make(['eng']));
        if (cancelled) break;
        const second = await alt.recognize(canvas, {}, { blocks: true, text: true });
        const altConf = (second.data as { confidence: number }).confidence;
        const altPage = toOcrPage(second.data, canvas, scale, page, altLang);
        if (altLang === 'ara') arabicReading = altPage;
        if (altConf > confidence + 5) {
          result = altPage;
          confidence = altConf;
        }
      }
      if (lang === 'auto' && result.lang !== 'ara') {
        const all = result.lines.map((l) => l.text).join(' ');
        const arab = count(all, ARABIC);
        const latin = count(all, LATIN);
        // Mostly Arabic: read again in Arabic only and keep the cleaner lines.
        if (arab > 0 && arab >= latin * 0.4) {
          if (!arabicReading) {
            phase = 0.5;
            arabicOnly ??= await make(['ara']);
            if (cancelled) break;
            const second = await arabicOnly.recognize(canvas, {}, { blocks: true, text: true });
            arabicReading = toOcrPage(second.data, canvas, scale, page, 'ara');
          }
          result = { ...result, lines: mergeReadings(result.lines, arabicReading.lines) };
        }
      }
      total += result.lines.length;
      if (confidence < 50) hardPages.push(i);
      useStore.getState().setOcr(ocrKey(page), { ...result, confidence: Math.round(confidence) });
    }
    return { pages: pages.length, lines: total, hardPages: hardPages.map((i) => pages[i].id) };
  })().finally(() => {
    workers.forEach((w) => w.terminate().catch(() => {}));
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      workers.forEach((w) => w.terminate().catch(() => {}));
    },
  };
}


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
        const tw = l.words.filter((w) => w.text.trim());
        // Columns ("Bill to ······ From") come back as one line: split at wide gaps.
        const order = tw.map((_, i) => i).sort((p, q) => tw[p].bbox.x0 - tw[q].bbox.x0);
        const groups: number[][] = [];
        for (const i of order) {
          const g = groups[groups.length - 1];
          const prev = g && tw[g[g.length - 1]];
          if (!g || tw[i].bbox.x0 - prev.bbox.x1 > Math.max(fsPx * 1.6, 12)) groups.push([i]);
          else g.push(i);
        }
        for (const g of groups) {
          const members = new Set(g);
          const ws = tw.filter((_, i) => members.has(i)); // reading order
          const bx0 = Math.min(...ws.map((w) => w.bbox.x0));
          const bx1 = Math.max(...ws.map((w) => w.bbox.x1));
          const chunkText = groups.length === 1 ? text : ws.map((w) => w.text.trim()).join(' ');
          const words: OcrWord[] = ws.map((w) => {
            const [x, y] = toBase(w.bbox.x0, baseAt(w.bbox.x0));
            return { text: w.text.trim(), x, y, w: (w.bbox.x1 - w.bbox.x0) / scale };
          });
          const [x, y] = toBase(bx0, baseAt(bx0));
          const corners = [toBase(bx0, l.bbox.y0), toBase(bx1, l.bbox.y0), toBase(bx0, l.bbox.y1), toBase(bx1, l.bbox.y1)];
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          const style = sampleStyle(ctx, bx0, l.bbox.y0, bx1, l.bbox.y1, fsPx);
          const conf = groups.length === 1 ? l.confidence : ws.reduce((sum, w) => sum + w.confidence, 0) / ws.length;
          lines.push({
            id: `ocr:${n++}`,
            text: chunkText,
            words,
            x,
            y,
            angle: Math.round((displayAngle - page.rotation) * 100) / 100,
            fontSize: Math.round((fsPx / scale) * 10) / 10,
            box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
            bg: style.bg,
            fg: style.fg,
            bold: style.bold,
            stroke: style.stroke,
            confidence: Math.round(conf),
            // Right-to-left when most letters are Arabic/Hebrew.
            rtl: count(chunkText, ARABIC) > count(chunkText, LATIN),
          });
        }
      }
    }
  }
  // Also compare with the page's usual weight (scans differ in how heavy all text looks).
  const latinStrokes = lines.filter((l) => !l.rtl && (l.stroke ?? 0) > 0).map((l) => l.stroke!).sort((a, b) => a - b);
  const usual = latinStrokes[Math.floor(latinStrokes.length / 2)] ?? 0;
  if (latinStrokes.length >= 4) for (const l of lines) if (!l.rtl && (l.stroke ?? 0) >= Math.max(0.1, usual * 1.22)) l.bold = true;
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
