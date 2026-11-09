// Gathers every comment in the document: ones added here and ones already in
// the PDF file (made in Acrobat, Preview, Edge…), and exports them as CSV.
import { useStore } from '../state/store';
import { getPdf } from './pdf';
import { parsePdfDate } from './pdfAnnots';
import { getTextLayout, textInBoxes, type Box } from './textLayout';
import type { MarkupAnn, NoteAnn, PageItem } from './types';

export interface CommentItem {
  key: string;
  pageId: string;
  pageNumber: number;
  /** Shown to people, e.g. "Highlight". */
  type: string;
  note: string;
  quoted: string;
  author: string;
  /** ISO date or ''. */
  date: string;
  box: Box;
  color: string | null;
  /** Added in this editor (editable) or already in the original file. */
  origin: 'editor' | 'file';
  annId?: string;
}

const FILE_TYPES: Record<string, string> = {
  Text: 'Sticky note',
  FreeText: 'Text box',
  Highlight: 'Highlight',
  Underline: 'Underline',
  StrikeOut: 'Strikeout',
  Squiggly: 'Squiggly underline',
  Square: 'Rectangle',
  Circle: 'Ellipse',
  Line: 'Line',
  Ink: 'Drawing',
  Polygon: 'Polygon',
  PolyLine: 'Polyline',
  Stamp: 'Stamp',
  Caret: 'Insert text',
  FileAttachment: 'Attachment',
  Sound: 'Sound',
};
const MARKUP_LABEL = { highlight: 'Highlight', underline: 'Underline', strikeout: 'Strikeout' } as const;

export interface RawFileComment {
  key: string;
  type: string;
  note: string;
  author: string;
  date: string;
  box: Box;
  color: string | null;
  quads: Box[];
  origin: 'file';
}

const fileCache = new Map<string, Promise<RawFileComment[]>>();

/** Comments stored in the original PDF for one page (read with pdf.js). */
export function fileComments(page: PageItem): Promise<RawFileComment[]> {
  if (!page.docId) return Promise.resolve([]);
  const key = `${page.docId}:${page.srcIndex}`;
  let p = fileCache.get(key);
  if (!p) {
    p = (async () => {
      const pdf = await getPdf(page.docId!);
      if (!pdf) return [];
      const pg = await pdf.getPage(page.srcIndex + 1);
      const vp = pg.getViewport({ scale: 1 });
      const toBox = (r: number[]): Box => {
        const [x1, y1] = vp.convertToViewportPoint(r[0], r[1]);
        const [x2, y2] = vp.convertToViewportPoint(r[2], r[3]);
        return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      };
      const annots = (await pg.getAnnotations()) as Record<string, unknown>[];
      const out: RawFileComment[] = [];
      for (const a of annots) {
        const subtype = String(a.subtype ?? '');
        if (!FILE_TYPES[subtype]) continue;
        const note = ((a.contentsObj as { str?: string })?.str ?? '').trim();
        const isMarkup = ['Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(subtype);
        if (!note && !isMarkup) continue;
        const qp = a.quadPoints as ArrayLike<number> | undefined;
        const quads: Box[] = [];
        if (qp && qp.length >= 8) {
          for (let i = 0; i + 7 < qp.length; i += 8) {
            const xs = [qp[i], qp[i + 2], qp[i + 4], qp[i + 6]];
            const ys = [qp[i + 1], qp[i + 3], qp[i + 5], qp[i + 7]];
            quads.push(toBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]));
          }
        }
        const c = a.color as ArrayLike<number> | null;
        out.push({
          key: `file:${key}:${a.id}`,
          type: FILE_TYPES[subtype],
          note,
          author: ((a.titleObj as { str?: string })?.str ?? '').trim(),
          date: parsePdfDate((a.modificationDate as string) ?? (a.creationDate as string)),
          box: toBox(a.rect as number[]),
          color: c && c.length >= 3 ? '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('') : null,
          quads,
          origin: 'file',
        });
      }
      return out;
    })().catch(() => []);
    fileCache.set(key, p);
  }
  return p;
}

/** Every comment in the document, in page order. */
export async function collectComments(): Promise<CommentItem[]> {
  const st = useStore.getState();
  const items: CommentItem[] = [];
  for (const [i, page] of st.present.pages.entries()) {
    const own = (st.present.annotations[page.id] ?? []).filter((a): a is NoteAnn | MarkupAnn => a.type === 'note' || a.type === 'markup');
    for (const a of own) {
      items.push({
        key: a.id,
        pageId: page.id,
        pageNumber: i + 1,
        type: a.type === 'note' ? 'Sticky note' : MARKUP_LABEL[a.kind],
        note: a.type === 'note' ? a.text : a.note,
        quoted: a.type === 'markup' ? a.quotedText : '',
        author: a.author || st.author,
        date: a.modified || a.created,
        box: a.type === 'note' ? { x: a.x, y: a.y, w: 18, h: 18 } : a.quads[0],
        color: a.color,
        origin: 'editor',
        annId: a.id,
      });
    }
    const fromFile = await fileComments(page);
    if (fromFile.length) {
      const layout = await getTextLayout(page);
      for (const c of fromFile) {
        items.push({
          key: `${page.id}:${c.key}`,
          pageId: page.id,
          pageNumber: i + 1,
          type: c.type,
          note: c.note,
          quoted: c.quads.length ? textInBoxes(layout, c.quads) : '',
          author: c.author,
          date: c.date,
          box: c.box,
          color: c.color,
          origin: 'file',
        });
      }
    }
  }
  // Within a page, top to bottom.
  items.sort((a, b) => a.pageNumber - b.pageNumber || a.box.y - b.box.y || a.box.x - b.box.x);
  return items;
}

const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function commentsToCsv(items: CommentItem[]): string {
  const header = ['Page', 'Type', 'Note', 'Marked text', 'Author', 'Date', 'X (pt from left)', 'Y (pt from top)', 'Color', 'Source'];
  const rows = items.map((c) => [
    c.pageNumber,
    c.type,
    c.note,
    c.quoted,
    c.author,
    c.date ? new Date(c.date).toLocaleString() : '',
    Math.round(c.box.x),
    Math.round(c.box.y),
    c.color ?? '',
    c.origin === 'editor' ? 'Added in PageCraft' : 'Already in the PDF',
  ]);
  // BOM so Excel opens Arabic and other non-Latin text correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export async function exportCommentsCsv() {
  const st = useStore.getState();
  st.setBusy('Collecting notes…');
  try {
    const items = await collectComments();
    if (!items.length) {
      st.toast('There are no notes or comments in this document yet.');
      return;
    }
    const blob = new Blob([commentsToCsv(items)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = st.fileName.replace(/\.pdf$/i, '') + '-notes.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    st.toast(`Exported ${items.length} note${items.length === 1 ? '' : 's'} to CSV.`);
  } finally {
    useStore.getState().setBusy(null);
  }
}
