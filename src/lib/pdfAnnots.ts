// Saves comments as real PDF annotations, so they show up in the comments
// panel of Acrobat, Chrome, Edge, macOS Preview and others.
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFPage, PDFRef, PDFString } from 'pdf-lib';
import type { MarkupAnn, NoteAnn } from './types';
import { apply, type Matrix } from './content/interpret';
import { NOTE_SIZE } from './geometry';

const SUBTYPE = { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut' } as const;

export function toPdfDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}

/** Parses a PDF date ("D:20261108113000+02'00'") into an ISO string. */
export function parsePdfDate(s: string | undefined | null): string {
  if (!s) return '';
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s);
  if (!m) return '';
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  const off = tz === '+' || tz === '-' ? `${tz}${th}:${tm}` : 'Z';
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${off}`);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

function rgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * Adds note and markup comments to a page. `B` maps base space (y up) to user
 * space; `H` is the base-space page height.
 */
export function addComments(doc: PDFDocument, page: PDFPage, anns: (NoteAnn | MarkupAnn)[], H: number, B: Matrix, defaultAuthor = '') {
  if (!anns.length) return;
  const ctx = doc.context;
  const toUser = (x: number, y: number) => apply(B, x, H - y);
  let annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) {
    annots = PDFArray.withContext(ctx);
    page.node.set(PDFName.of('Annots'), annots);
  }
  const list = annots as PDFArray;

  const addPopup = (parent: PDFRef, rect: number[]) => {
    const popup = ctx.register(
      ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [rect[2], rect[3] - 110, rect[2] + 200, rect[3]], Parent: parent, Open: false, F: 28 }),
    );
    list.push(popup);
    return popup;
  };

  const common = (a: NoteAnn | MarkupAnn, text: string) => ({
    Type: 'Annot',
    C: rgb01(a.color),
    Contents: PDFHexString.fromText(text),
    T: PDFHexString.fromText(a.author || defaultAuthor || 'Anonymous'),
    M: PDFString.of(toPdfDate(a.modified)),
    CreationDate: PDFString.of(toPdfDate(a.created)),
    NM: PDFString.of(a.id),
  });

  for (const a of anns) {
    if (a.type === 'note') {
      const p1 = toUser(a.x, a.y);
      const p2 = toUser(a.x + NOTE_SIZE, a.y + NOTE_SIZE);
      const rect = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
      const dict = ctx.obj({ ...common(a, a.text), Subtype: 'Text', Rect: rect, Name: 'Comment', Open: false, F: 28 });
      const ref = ctx.register(dict);
      list.push(ref);
      dict.set(PDFName.of('Popup'), addPopup(ref, rect));
      continue;
    }

    // Markup: QuadPoints are listed upper-left, upper-right, lower-left, lower-right.
    const quadPts: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const quads = a.quads.map((q) => {
      const ul = toUser(q.x, q.y);
      const ur = toUser(q.x + q.w, q.y);
      const ll = toUser(q.x, q.y + q.h);
      const lr = toUser(q.x + q.w, q.y + q.h);
      quadPts.push(...ul, ...ur, ...ll, ...lr);
      [ul, ur, ll, lr].forEach(([x, y]) => {
        xs.push(x);
        ys.push(y);
      });
      return { ul, ur, ll, lr };
    });
    const rect = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
    const [r, g, b] = rgb01(a.color);
    // Appearance stream so every reader draws it the same way.
    let content = '';
    if (a.kind === 'highlight') {
      content += `/GS0 gs ${f(r)} ${f(g)} ${f(b)} rg\n`;
      for (const q of quads) content += `${f(q.ul[0])} ${f(q.ul[1])} m ${f(q.ur[0])} ${f(q.ur[1])} l ${f(q.lr[0])} ${f(q.lr[1])} l ${f(q.ll[0])} ${f(q.ll[1])} l h f\n`;
    } else {
      content += `/GS0 gs ${f(r)} ${f(g)} ${f(b)} RG\n`;
      for (const q of quads) {
        const h = Math.hypot(q.ll[0] - q.ul[0], q.ll[1] - q.ul[1]);
        const t = a.kind === 'underline' ? 0.1 : 0.5; // fraction up from the bottom edge
        const sx = q.ll[0] + (q.ul[0] - q.ll[0]) * t;
        const sy = q.ll[1] + (q.ul[1] - q.ll[1]) * t;
        const ex = q.lr[0] + (q.ur[0] - q.lr[0]) * t;
        const ey = q.lr[1] + (q.ur[1] - q.lr[1]) * t;
        content += `${f(Math.max(0.6, h * 0.07))} w ${f(sx)} ${f(sy)} m ${f(ex)} ${f(ey)} l S\n`;
      }
    }
    const gs = ctx.obj({ Type: 'ExtGState', CA: a.opacity, ca: a.opacity, ...(a.kind === 'highlight' ? { BM: 'Multiply' } : {}) });
    const ap = ctx.register(
      ctx.flateStream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: rect,
        Resources: ctx.obj({ ExtGState: ctx.obj({ GS0: gs }) }),
      }),
    );
    const dict = ctx.obj({
      ...common(a, a.note),
      Subtype: SUBTYPE[a.kind],
      Rect: rect,
      QuadPoints: quadPts.map((v) => Math.round(v * 1000) / 1000),
      CA: a.opacity,
      F: 4,
      AP: ctx.obj({ N: ap }),
    });
    const ref = ctx.register(dict);
    list.push(ref);
    if (a.note.trim()) dict.set(PDFName.of('Popup'), addPopup(ref, rect));
  }
}
