import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetBase = new URL('pdfjs/', document.baseURI).href;

const docs = new Map<string, Promise<PDFDocumentProxy>>();

export class PasswordRequiredError extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'Password required');
  }
}

/** Opens a PDF with pdf.js and caches the proxy under `id`. */
export async function openPdf(id: string, bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    // pdf.js transfers the buffer to its worker, so hand it a copy.
    data: bytes.slice(),
    password,
    cMapUrl: assetBase + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: assetBase + 'standard_fonts/',
    wasmUrl: assetBase + 'wasm/',
    iccUrl: assetBase + 'iccs/',
  });
  const promise = task.promise.catch((err: unknown) => {
    docs.delete(id);
    const e = err as { name?: string; code?: number };
    if (e?.name === 'PasswordException') throw new PasswordRequiredError(e.code === 2);
    throw err;
  });
  docs.set(id, promise);
  return promise;
}

export function getPdf(id: string): Promise<PDFDocumentProxy> | undefined {
  return docs.get(id);
}

export async function getPage(docId: string, index: number): Promise<PDFPageProxy> {
  const doc = await docs.get(docId);
  if (!doc) throw new Error('Document not loaded');
  return doc.getPage(index + 1);
}

/** Page sizes in points with the page's own /Rotate applied. */
export async function getPageSizes(doc: PDFDocumentProxy): Promise<{ width: number; height: number }[]> {
  const sizes: { width: number; height: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  return sizes;
}

export interface RenderHandle {
  promise: Promise<void>;
  cancel(): void;
}

/**
 * Renders a page into a canvas. `scale` is CSS pixels per point; the canvas
 * backing store is multiplied by devicePixelRatio for crisp output.
 */
export function renderPage(
  docId: string,
  index: number,
  extraRotation: number,
  scale: number,
  canvas: HTMLCanvasElement,
): RenderHandle {
  let task: RenderTask | null = null;
  let cancelled = false;
  const promise = (async () => {
    const page = await getPage(docId, index);
    if (cancelled) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + extraRotation) % 360 });
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(viewport.width));
    off.height = Math.max(1, Math.floor(viewport.height));
    task = page.render({ canvas: off, viewport });
    try {
      await task.promise;
    } catch (err) {
      if ((err as { name?: string })?.name === 'RenderingCancelledException') return;
      throw err;
    }
    if (cancelled) return;
    // Swap in the finished frame at once to avoid flicker while zooming.
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d')!.drawImage(off, 0, 0);
  })();
  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** Renders a page to a PNG blob at a given DPI (for "export as image"). */
export async function renderPageToBlob(docId: string, index: number, extraRotation: number, dpi: number): Promise<Blob> {
  const page = await getPage(docId, index);
  const viewport = page.getViewport({ scale: dpi / 72, rotation: (page.rotate + extraRotation) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png'),
  );
}

export function forgetPdf(id: string) {
  const p = docs.get(id);
  docs.delete(id);
  p?.then((d) => d.loadingTask.destroy()).catch(() => {});
}
