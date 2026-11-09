// Browser-side glue for editing original PDF content. pdf-lib and the content
// engine are loaded on demand so the first page load stays small.
import { useEffect, useMemo, useState } from 'react';
import { useStore, uid } from '../../state/store';
import { measureText, usesOriginalFont } from '../geometry';
import { hasRtl } from '../bidi';
import { forgetPdf, openPdf, renderPage } from '../pdf';
import { loadUnicodeFont } from '../fontsLoader';
import type { Annotation, PageItem, TextAnn } from '../types';
import type { ImageTarget, PageAnalysis, TextSegment } from './page';

// ---------- Analysis ----------

const analyses = new Map<string, Promise<PageAnalysis | null>>();
/** Finished analyses, for synchronous use after the first load. */
const ready = new Map<string, PageAnalysis>();

/** Text segments and images of a source page, in base space. Null if the file can't be edited. */
export function getAnalysis(page: PageItem): Promise<PageAnalysis | null> {
  if (!page.docId) return Promise.resolve(null);
  const key = `${page.docId}:${page.srcIndex}`;
  let p = analyses.get(key);
  if (!p) {
    const doc = useStore.getState().docs[page.docId];
    p = (async () => {
      const mod = await import('./page');
      const pdf = await mod.sourceDoc(page.docId!, doc.bytes);
      if (!pdf) return null;
      const a = mod.analyzePage(pdf.getPage(page.srcIndex), page.height);
      ready.set(key, a);
      return a;
    })().catch((err) => {
      console.error('Analysis failed', err);
      return null;
    });
    analyses.set(key, p);
  }
  return p;
}

/** Makes an editable text item from a segment of the PDF's own text. */
export function segmentToAnn(seg: TextSegment, dx = 0): TextAnn {
  const rad = (seg.angle * Math.PI) / 180;
  const rtl = hasRtl(seg.text);
  const ann: TextAnn = {
    id: uid('ann'),
    type: 'text',
    x: seg.originX + Math.sin(rad) * seg.ascent * seg.fontSize + dx,
    y: seg.originY - Math.cos(rad) * seg.ascent * seg.fontSize,
    text: seg.text,
    fontSize: seg.fontSize,
    font: seg.fallback.family,
    bold: seg.fallback.bold,
    italic: seg.fallback.italic,
    color: seg.color,
    opacity: 1,
    angle: seg.angle,
    source: {
      fontRes: seg.fontRes,
      fontName: seg.fontName,
      ascent: seg.ascent,
      hScale: seg.hScale,
      tc: seg.tc,
      tw: seg.tw,
      chars: seg.chars,
      // Arabic needs letter joining, which only the bundled font can do.
      useOriginal: !rtl,
      originalText: seg.text,
      segId: seg.id,
    },
  };
  if (rtl) {
    // Keep the right edge where the original line ended.
    if (seg.angle === 0) ann.x = seg.box.x + seg.box.w - measureText(ann).w;
    else {
      const shift = seg.advance - measureText(ann).w;
      ann.x += shift * Math.cos(rad);
      ann.y += shift * Math.sin(rad);
    }
  }
  return ann;
}

/** Width of a text item's first line along its baseline, in points. */
function advanceOf(a: TextAnn, analysis: PageAnalysis): number {
  const line = a.text.split('\n')[0];
  const font = a.source ? analysis.fonts.get(a.source.fontRes) : undefined;
  if (font && a.source && usesOriginalFont(a)) {
    let w = 0;
    const chars = [...line];
    chars.forEach((ch, i) => {
      const code = font.fromUnicode(ch);
      const gw = code !== undefined ? font.width(code) : ch === ' ' ? 0.25 : 0.5;
      // Character spacing applies between glyphs, not after the last one.
      w += gw + (i < chars.length - 1 ? a.source!.tc + (ch === ' ' ? a.source!.tw : 0) : 0);
    });
    return w * a.fontSize * (a.source.hScale || 1);
  }
  return measureText({ ...a, text: line }).w;
}

/**
 * After a line of the PDF's text was edited, slide the rest of that line by the
 * change in width so words don't overlap or leave a hole.
 */
export function reflowLine(pageId: string, annId: string) {
  const st = useStore.getState();
  const page = st.present.pages.find((p) => p.id === pageId);
  const ann = st.present.annotations[pageId]?.find((a) => a.id === annId) as TextAnn | undefined;
  if (!page?.docId || !ann?.source || ann.text.includes('\n') || hasRtl(ann.text)) return;
  const analysis = ready.get(`${page.docId}:${page.srcIndex}`);
  const seg = analysis?.segments.find((sg) => sg.id === ann.source!.segId);
  if (!analysis || !seg || seg.angle !== 0) return;
  // If the user dragged the edited text elsewhere, the line no longer flows.
  const home = segmentToAnn(seg);
  if (Math.abs(home.x - ann.x) > 0.5 || Math.abs(home.y - ann.y) > 0.5) return;

  const removed = new Set(st.present.removed[pageId] ?? []);
  const anns = st.present.annotations[pageId] ?? [];
  // Positions are computed from the original layout, so re-editing never shifts twice.
  let offset = (ann.text.trim() ? advanceOf(ann, analysis) : 0) - seg.advance;
  const setX = new Map<string, number>();
  const created: TextAnn[] = [];
  const newRemoved: string[] = [];
  for (let id = seg.next; id; ) {
    const sib = analysis.segments.find((sg) => sg.id === id);
    if (!sib) break;
    const sibHome = segmentToAnn(sib);
    const existing = anns.find((a): a is TextAnn => a.type === 'text' && a.source?.segId === sib.id);
    if (existing) {
      if (Math.abs(existing.y - sibHome.y) > 0.5) break; // moved away by the user
      setX.set(existing.id, sibHome.x + offset);
      if (existing.text !== sib.text) offset += (existing.text.trim() ? advanceOf(existing, analysis) : 0) - sib.advance;
    } else if (!removed.has(sib.glyphIds[0])) {
      if (Math.abs(offset) >= 0.05) {
        created.push({ ...sibHome, x: sibHome.x + offset });
        newRemoved.push(...sib.glyphIds);
      }
    } else break;
    id = sib.next;
  }
  if (!setX.size && !created.length) return;
  st.live((s) => ({
    ...s,
    removed: { ...s.removed, [pageId]: [...(s.removed[pageId] ?? []), ...newRemoved] },
    annotations: {
      ...s.annotations,
      [pageId]: [...(s.annotations[pageId] ?? []).map((a) => (setX.has(a.id) ? { ...a, x: setX.get(a.id)! } : a)), ...created],
    },
  }));
}

// ---------- Rendering one original image on its own ----------

/** Renders just one image of a page (transparent background) to a PNG blob. */
export async function renderImageTarget(page: PageItem, target: ImageTarget): Promise<Blob> {
  const [{ PDFDocument }, mod] = await Promise.all([import('pdf-lib'), import('./page')]);
  const doc = useStore.getState().docs[page.docId!];
  const src = await mod.sourceDoc(page.docId!, doc.bytes);
  if (!src) throw new Error('Source not readable');
  const out = await PDFDocument.create();
  const [copy] = await out.copyPages(src, [page.srcIndex]);
  out.addPage(copy);
  const content = mod.interpretPage(copy);
  const op = content.ops[target.op];
  const im = content.images.find((i) => i.op === target.op);
  if (!op || !im) throw new Error('Image not found');
  const m = im.matrix.map((v) => +v.toFixed(6)).join(' ');
  const head = new TextEncoder().encode(`q ${m} cm\n`);
  const raw = content.data.subarray(op.start, op.end);
  const tail = new TextEncoder().encode('\nQ\n');
  const bytes = new Uint8Array(head.length + raw.length + tail.length);
  bytes.set(head, 0);
  bytes.set(raw, head.length);
  bytes.set(tail, head.length + raw.length);
  const { PDFName } = await import('pdf-lib');
  copy.node.set(PDFName.of('Contents'), out.context.register(out.context.flateStream(bytes)));
  const pdfBytes = await out.save();

  const tmpId = `imgsrc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdf = await openPdf(tmpId, pdfBytes);
  try {
    const p = await pdf.getPage(1);
    const scale = Math.min(4, 1600 / Math.max(target.box.w, target.box.h, 1));
    const vp = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await p.render({ canvas, viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(target.box.w * scale));
    crop.height = Math.max(1, Math.round(target.box.h * scale));
    crop.getContext('2d')!.drawImage(canvas, -target.box.x * scale, -target.box.y * scale);
    return await new Promise((res, rej) => crop.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));
  } finally {
    forgetPdf(tmpId);
  }
}

// ---------- Live preview of edited pages ----------

const previews = new Map<string, Promise<string>>();
const previewOrder: string[] = [];
const MAX_PREVIEWS = 40;

function getPreview(key: string, build: () => Promise<Uint8Array>): Promise<string> {
  let p = previews.get(key);
  if (!p) {
    const id = `preview_${previewOrder.length}_${Date.now().toString(36)}`;
    p = build().then(async (bytes) => {
      await openPdf(id, bytes);
      return id;
    });
    previews.set(key, p);
    previewOrder.push(key);
    while (previewOrder.length > MAX_PREVIEWS) {
      const old = previewOrder.shift()!;
      previews.get(old)?.then(forgetPdf).catch(() => {});
      previews.delete(old);
    }
    p.catch(() => previews.delete(key));
  }
  return p;
}

const EMPTY: Annotation[] = [];

/**
 * Which PDF page to render for a page item: the original, or a preview with
 * content edits (removed text/images and re-typed original text) applied.
 */
export function useRenderSource(page: PageItem): { docId: string; index: number } | null {
  const removed = useStore((s) => s.present.removed[page.id]);
  const anns = useStore((s) => s.present.annotations[page.id] ?? EMPTY);
  const editing = useStore((s) => s.editingText);
  const original = useMemo(() => (page.docId ? { docId: page.docId, index: page.srcIndex } : null), [page.docId, page.srcIndex]);

  const texts = useMemo(() => anns.filter((a): a is TextAnn => a.type === 'text' && !!a.source && a.id !== editing), [anns, editing]);
  const key = useMemo(() => {
    if (!page.docId || (!removed?.length && !texts.length)) return null;
    return JSON.stringify([
      page.docId,
      page.srcIndex,
      page.width,
      page.height,
      removed ?? [],
      texts.map((t) => [t.text, t.x, t.y, t.fontSize, t.color, t.angle, t.font, t.bold, t.italic, t.source!.useOriginal, t.opacity]),
    ]);
  }, [page.docId, page.srcIndex, page.width, page.height, removed, texts]);

  const [src, setSrc] = useState(original);
  useEffect(() => {
    if (!key) {
      setSrc(original);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      const st = useStore.getState();
      getPreview(key, async () => {
        const { exportPdf } = await import('../exportPdf');
        const res = await exportPdf({
          pages: [{ ...page, rotation: 0 }],
          annotations: { [page.id]: texts },
          removed: { [page.id]: removed ?? [] },
          docs: st.docs,
          images: st.images,
          loadUnicodeFont,
        });
        return res.bytes;
      })
        .then((id) => alive && setSrc({ docId: id, index: 0 }))
        .catch((err) => console.error('Preview failed', err));
    }, 40);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, original]);
  return key ? src : original;
}

export { renderPage };
