import { useStore, uid } from '../state/store';
import type { ExportInput } from './exportPdf';
import { forgetPdf, openPdf, renderPageToBlob } from './pdf';
import { measureText } from './geometry';
import type { PageItem, TextAnn } from './types';

function download(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** pdf-lib is only needed when saving, so it loads on demand. */
const exportPdf: typeof import('./exportPdf').exportPdf = async (input) => (await import('./exportPdf')).exportPdf(input);

function exportInput(pages?: PageItem[]): ExportInput {
  const s = useStore.getState();
  return {
    pages: pages ?? s.present.pages,
    annotations: s.present.annotations,
    removed: s.present.removed,
    ocr: s.ocr,
    author: s.author,
    docs: s.docs,
    images: s.images,
    title: s.fileName.replace(/\.pdf$/i, ''),
    rasterize: async (docId, index) =>
      new Uint8Array(await (await renderPageToBlob(docId, index, 0, 200)).arrayBuffer()),
  };
}

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  const s = useStore.getState();
  s.setBusy(label);
  // Let the busy overlay paint before heavy work starts.
  await new Promise((r) => setTimeout(r, 30));
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    s.toast(`Something went wrong: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return undefined;
  } finally {
    useStore.getState().setBusy(null);
  }
}

export async function saveDocument() {
  const s = useStore.getState();
  if (!s.present.pages.length) return;
  s.setEditingText(null);
  await run('Saving PDF…', async () => {
    const { bytes, warnings } = await exportPdf(exportInput());
    download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), s.fileName);
    useStore.getState().markSaved();
    warnings.forEach((w) => useStore.getState().toast(w, 'error'));
    useStore.getState().toast(`Saved ${s.fileName}`);
  });
}

export async function extractPages(pageIds: string[]) {
  const s = useStore.getState();
  const ids = new Set(pageIds);
  const pages = s.present.pages.filter((p) => ids.has(p.id));
  if (!pages.length) return;
  await run('Extracting pages…', async () => {
    const { bytes, warnings } = await exportPdf(exportInput(pages));
    const base = s.fileName.replace(/\.pdf$/i, '');
    download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${base}-pages.pdf`);
    warnings.forEach((w) => useStore.getState().toast(w, 'error'));
    useStore.getState().toast(`Extracted ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
  });
}

/** Splits the document into one PDF per page. */
export async function splitAllPages() {
  const s = useStore.getState();
  const base = s.fileName.replace(/\.pdf$/i, '');
  await run('Splitting pages…', async () => {
    const pages = s.present.pages;
    for (let i = 0; i < pages.length; i++) {
      const { bytes } = await exportPdf(exportInput([pages[i]]));
      download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${base}-page-${i + 1}.pdf`);
      await new Promise((r) => setTimeout(r, 150));
    }
    useStore.getState().toast(`Split into ${pages.length} files.`);
  });
}

/** Saves pages as PNG images. Edits are included by rendering the exported PDF. */
export async function exportPagesAsImages(pageIds: string[], dpi = 150) {
  const s = useStore.getState();
  const ids = new Set(pageIds);
  const pages = s.present.pages.filter((p) => ids.has(p.id));
  if (!pages.length) return;
  const base = s.fileName.replace(/\.pdf$/i, '');
  await run('Rendering images…', async () => {
    const { bytes } = await exportPdf(exportInput(pages));
    const tmpId = uid('tmp');
    await openPdf(tmpId, bytes);
    try {
      for (let i = 0; i < pages.length; i++) {
        const blob = await renderPageToBlob(tmpId, i, 0, dpi);
        const n = s.present.pages.indexOf(pages[i]) + 1;
        download(blob, `${base}-page-${n}.png`);
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      forgetPdf(tmpId);
    }
  });
}

export function insertBlankPage(at: number, like?: PageItem) {
  const s = useStore.getState();
  const page: PageItem = {
    id: uid('page'),
    docId: null,
    srcIndex: 0,
    width: like ? (like.rotation % 180 ? like.height : like.width) : 595.28,
    height: like ? (like.rotation % 180 ? like.width : like.height) : 841.89,
    rotation: 0,
  };
  s.insertPages([page], at);
  s.scrollToPage(page.id);
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  diagonal: boolean;
}

export function addWatermark(o: WatermarkOptions) {
  const s = useStore.getState();
  s.addAnnotationsToPages((p) => {
    const base: Omit<TextAnn, 'x' | 'y'> = {
      id: uid('ann'),
      type: 'text',
      text: o.text,
      fontSize: o.fontSize,
      font: 'Helvetica',
      bold: true,
      italic: false,
      color: o.color,
      opacity: o.opacity,
      angle: 0,
    };
    const { w, h } = measureText(base);
    // Watermarks are centered in display orientation, so undo the page's editor rotation.
    const [dw, dh] = p.rotation % 180 ? [p.height, p.width] : [p.width, p.height];
    const angleDisplay = o.diagonal ? -Math.round((Math.atan2(dh, dw) * 180) / Math.PI) : 0;
    const angle = angleDisplay - p.rotation;
    const rad = (angle * Math.PI) / 180;
    // Place the rotated box so its center lands on the page center.
    const cx = p.width / 2;
    const cy = p.height / 2;
    const x = cx - (w / 2) * Math.cos(rad) + (h / 2) * Math.sin(rad);
    const y = cy - (w / 2) * Math.sin(rad) - (h / 2) * Math.cos(rad);
    return { ...base, x, y, angle };
  });
  s.toast('Watermark added to every page. Select it to change or delete.');
}

export interface PageNumberOptions {
  format: 'n' | 'page-n' | 'n-of-total';
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right';
  fontSize: number;
  startAt: number;
}

export function addPageNumbers(o: PageNumberOptions) {
  const s = useStore.getState();
  const total = s.present.pages.length;
  const indexOf = new Map(s.present.pages.map((p, i) => [p.id, i]));
  s.addAnnotationsToPages((p) => {
    const n = indexOf.get(p.id)! + o.startAt;
    const text = o.format === 'n' ? `${n}` : o.format === 'page-n' ? `Page ${n}` : `${n} of ${total + o.startAt - 1}`;
    const base = { id: uid('ann'), type: 'text' as const, text, fontSize: o.fontSize, font: 'Helvetica' as const, bold: false, italic: false, color: '#333333', opacity: 1 };
    const { w, h } = measureText(base);
    // Position in display space, then map into base space.
    const dw = p.rotation % 180 ? p.height : p.width;
    const dh = p.rotation % 180 ? p.width : p.height;
    const m = 28;
    let dx = (dw - w) / 2;
    let dy = dh - m - h;
    if (o.position === 'bottom-right') dx = dw - m - w;
    if (o.position === 'bottom-left') dx = m;
    if (o.position === 'top-right') {
      dx = dw - m - w;
      dy = m;
    }
    // Top-left of the box in display space → base space, with text rotated to stay upright.
    const angle = -p.rotation;
    let x = dx,
      y = dy;
    if (p.rotation === 90) {
      x = dy;
      y = p.height - dx;
    } else if (p.rotation === 180) {
      x = p.width - dx;
      y = p.height - dy;
    } else if (p.rotation === 270) {
      x = p.width - dy;
      y = dx;
    }
    return { ...base, x, y, angle };
  });
  s.toast('Page numbers added. Each one can be edited or moved.');
}
