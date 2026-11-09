import { memo, useEffect, useRef, useState } from 'react';
import { Copy, Highlighter, MessageSquarePlus, Strikethrough, Underline } from 'lucide-react';
import { useStore, uid, ocrKey } from '../state/store';
import type { Annotation, ImageAnn, InkAnn, LineAnn, MarkupAnn, MarkupKind, NoteAnn, OcrLine, PageItem, RectAnn, TextAnn } from '../lib/types';
import { BASELINE, NOTE_SIZE, annBox, baseToDisplay, displaySize, displayToBase, fullImageBox, isAnchored, moveAnn, resizeAnn, simplify, type Box } from '../lib/geometry';
import { getTextLayout, isOverText, selectAllText, selectBetween, selectLine, selectWord, type LayoutLine, type TextSelection } from '../lib/textLayout';
import { applyCrop, startCrop } from '../lib/crop';
import { renderPage } from '../lib/pdf';
import { loadImage, rotatedImage } from '../lib/importFiles';
import { getAnalysis, renderImageTarget, segmentToAnn, useRenderSource } from '../lib/content/editorBridge';
import type { ImageTarget, PageAnalysis, TextSegment } from '../lib/content/page';
import { AnnotationShapes, NoteIcon } from './AnnotationShapes';
import { fileComments, type RawFileComment } from '../lib/comments';
import { TextEditor } from './TextEditor';

const EMPTY: Annotation[] = [];

type Handle = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'move'; annId: string; sx: number; sy: number; orig: Annotation; moved?: boolean; editOnClick?: boolean }
  | { kind: 'resize'; annId: string; handle: Handle; orig: Annotation; box: Box }
  | { kind: 'endpoint'; annId: string; which: 1 | 2 }
  | { kind: 'create'; annId: string; sx: number; sy: number }
  | { kind: 'ink'; annId: string }
  | { kind: 'textsel'; annId: ''; sx: number; sy: number }
  | { kind: 'crop'; annId: ''; mode: 'move' | Handle; sx: number; sy: number; start: Box; full: Box };

/** Becomes true while the element is near the viewport. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, margin = '1200px') {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
}

interface Props {
  page: PageItem;
  index: number;
}

export const PageView = memo(function PageView({ page, index }: Props) {
  const zoom = useStore((s) => s.zoom);
  const annotations = useStore((s) => s.present.annotations[page.id] ?? EMPTY);
  const images = useStore((s) => s.images);
  const tool = useStore((s) => s.tool);
  const selectedId = useStore((s) => (s.selection?.pageId === page.id ? s.selection.annId : null));
  const editingText = useStore((s) => s.editingText);
  const outerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const near = useNearViewport(outerRef);
  const [rendered, setRendered] = useState(false);
  const renderedScale = useRef<string | null>(null);
  const renderSrc = useRenderSource(page);
  const removedIds = useStore((s) => s.present.removed[page.id]);
  const ocrResult = useStore((s) => s.ocr[ocrKey(page)]);
  const [analysis, setAnalysis] = useState<PageAnalysis | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutLine[] | null>(null);
  const textSel = useStore((s) => (s.textSel?.pageId === page.id ? s.textSel : null));
  const setTextSel = (sel: TextSelection | null) => useStore.getState().setTextSel(sel ? { pageId: page.id, ...sel } : null);
  const selectAllRequest = useStore((s) => (s.selectAllRequest?.pageId === page.id ? s.selectAllRequest : null));
  const [selecting, setSelecting] = useState(false);
  const [overText, setOverText] = useState(false);
  const [fileNotes, setFileNotes] = useState<RawFileComment[]>([]);
  const find = useStore((s) => s.find);
  const crop = useStore((s) => (s.cropping?.pageId === page.id ? s.cropping : null));

  const disp = displaySize(page);
  const pendingImage = useStore((s) => (s.pendingImage ? s.images[s.pendingImage] : null));
  const [ghost, setGhost] = useState<[number, number] | null>(null);
  const placing = (tool === 'image' || tool === 'signature') && !!pendingImage;
  /** Default size for a newly placed image or signature. */
  // Sizes are in base space; on a page rotated by 90/270 the image is turned to stay upright, so its sides swap.
  const placeSize = (img: { width: number; height: number }): [number, number] => {
    const swap = page.rotation % 180 !== 0;
    const iw = swap ? img.height : img.width;
    const ih = swap ? img.width : img.height;
    const longest = Math.min(tool === 'signature' ? 170 : 240, (swap ? page.height : page.width) * 0.6);
    const along = swap ? ih : iw; // size along the reader's horizontal axis
    const k = longest / along;
    return [iw * k, ih * k];
  };

  // ----- Rendering (base orientation; editor rotation is applied in CSS) -----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!renderSrc || !canvas) return;
    if (!near) {
      if (renderedScale.current !== null) {
        canvas.width = canvas.height = 0;
        renderedScale.current = null;
        setRendered(false);
      }
      return;
    }
    const key = `${renderSrc.docId}:${renderSrc.index}:${zoom}`;
    if (renderedScale.current === key) return;
    const zoomOnly = renderedScale.current?.startsWith(`${renderSrc.docId}:${renderSrc.index}:`);
    let handle: ReturnType<typeof renderPage> | null = null;
    const t = setTimeout(
      () => {
        handle = renderPage(renderSrc.docId, renderSrc.index, 0, zoom, canvas);
        handle.promise
          .then(() => {
            renderedScale.current = key;
            setRendered(true);
          })
          .catch((err) => console.error('Render failed', err));
      },
      // Content edits re-render at once; zooming waits until the wheel settles.
      renderedScale.current === null || !zoomOnly ? 0 : 140,
    );
    return () => {
      clearTimeout(t);
      handle?.cancel();
    };
  }, [near, zoom, renderSrc]);

  // ----- Edit mode: find the page's own text and images -----
  useEffect(() => {
    if (tool !== 'edit' || !near || !page.docId) return;
    let alive = true;
    getAnalysis(page).then((a) => {
      if (!alive) return;
      setAnalysis(a);
      if (!a) useStore.getState().toast("This file's content can't be edited (it's encrypted or damaged). You can still add text and drawings on top.", 'error');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, near, page.docId, page.srcIndex]);

  // Sticky notes already in the file: pdf.js leaves their icons to its viewer, so draw them here.
  useEffect(() => {
    if (!near || !page.docId) return;
    let alive = true;
    fileComments(page).then((list) => alive && setFileNotes(list.filter((c) => c.type === 'Sticky note')));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, page.docId, page.srcIndex]);

  // Text positions for selecting text (real text and OCR).
  useEffect(() => {
    if (tool !== 'select' || !near) {
      setOverText(false);
      return;
    }
    let alive = true;
    getTextLayout(page).then((l) => alive && setLayout(l));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, near, page.docId, page.srcIndex, removedIds, ocrResult]);

  // Ctrl+A selects all text on the active page.
  useEffect(() => {
    if (!selectAllRequest) return;
    (layout ? Promise.resolve(layout) : getTextLayout(page)).then((l) => {
      const sel = selectAllText(l);
      if (sel) setTextSel(sel);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectAllRequest]);

  /** Turns the current text selection into a highlight, underline or strike-out. */
  const addMarkup = (kind: MarkupKind, withNote: boolean) => {
    if (!textSel) return;
    const st = useStore.getState();
    const now = new Date().toISOString();
    const ann: MarkupAnn = {
      id: uid('ann'),
      type: 'markup',
      kind,
      quads: textSel.quads,
      color: kind === 'highlight' ? st.style.highlightColor : kind === 'underline' ? '#2F5BEA' : '#C2362B',
      note: '',
      quotedText: textSel.text,
      author: st.author,
      created: now,
      modified: now,
      opacity: 1,
    };
    st.addAnnotation(page.id, ann);
    st.select({ pageId: page.id, annId: ann.id });
    if (withNote) {
      st.setRightPanel('properties');
      st.setFocusNote(ann.id);
    }
    setTextSel(null);
  };

  const removedSet = new Set(removedIds ?? []);
  const editTargets =
    tool === 'edit' && (analysis || ocrResult)
      ? {
          segments: (analysis?.segments ?? []).filter((sg) => !removedSet.has(sg.glyphIds[0])),
          // A picture covering (almost) the whole page is a scan or background, not something to pick up.
          images: (analysis?.images ?? []).filter((im) => !removedSet.has(im.id) && im.box.w * im.box.h < page.width * page.height * 0.8),
          ocr: (ocrResult?.lines ?? []).filter((l) => !removedSet.has(l.id)),
        }
      : null;

  const hitTarget = (
    x: number,
    y: number,
  ): { kind: 'text'; seg: TextSegment } | { kind: 'image'; img: ImageTarget } | { kind: 'ocr'; line: OcrLine } | null => {
    if (!editTargets) return null;
    const pad = 2;
    const inBox = (b: Box) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
    const segs = editTargets.segments.filter((sg) => inBox(sg.box)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
    if (segs.length) return { kind: 'text', seg: segs[0] };
    const ocrHit = editTargets.ocr.find((l) => inBox(l.box));
    if (ocrHit) return { kind: 'ocr', line: ocrHit };
    const imgs = editTargets.images.filter((im) => inBox(im.box)).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h);
    if (imgs.length) return { kind: 'image', img: imgs[0] };
    return null;
  };

  /** Turns a line of the PDF's own text into an editable text item. */
  const convertSegment = (seg: TextSegment) => {
    const st = useStore.getState();
    const ann = segmentToAnn(seg);
    st.beginGesture();
    st.live((s) => ({
      ...s,
      removed: { ...s.removed, [page.id]: [...(s.removed[page.id] ?? []), ...seg.glyphIds] },
      annotations: { ...s.annotations, [page.id]: [...(s.annotations[page.id] ?? []), ann] },
    }));
    st.select({ pageId: page.id, annId: ann.id });
    st.setEditingText(ann.id);
    if (seg.unknown) st.toast('Some characters in this line could not be read from the file, so they may show as "?".', 'error');
    setHover(null);
  };

  /** Makes a recognised line of a scan editable: paper-coloured cover + new text on top. */
  const convertOcrLine = (line: OcrLine) => {
    const st = useStore.getState();
    if (line.rtl) {
      st.toast("Editing Arabic text from scans isn't supported yet. It's already searchable and copyable in the saved PDF.", 'error');
      return;
    }
    const rad = (line.angle * Math.PI) / 180;
    const cover: RectAnn = {
      id: uid('ann'),
      type: 'whiteout',
      x: line.box.x - 1.2,
      y: line.box.y - 0.4,
      w: line.box.w + 2.4,
      h: line.box.h + 0.8,
      stroke: null,
      fill: line.bg,
      strokeWidth: 0,
      opacity: 1,
    };
    const text: TextAnn = {
      id: uid('ann'),
      type: 'text',
      x: line.x + Math.sin(rad) * BASELINE.Helvetica * line.fontSize,
      y: line.y - Math.cos(rad) * BASELINE.Helvetica * line.fontSize,
      text: line.text,
      fontSize: line.fontSize,
      font: 'Helvetica',
      bold: false,
      italic: false,
      color: line.fg,
      opacity: 1,
      angle: line.angle,
      ocrText: line.text,
    };
    st.beginGesture();
    st.live((s) => ({
      ...s,
      removed: { ...s.removed, [page.id]: [...(s.removed[page.id] ?? []), line.id] },
      annotations: { ...s.annotations, [page.id]: [...(s.annotations[page.id] ?? []), cover, text] },
    }));
    st.select({ pageId: page.id, annId: text.id });
    st.setEditingText(text.id);
    setHover(null);
  };

  /** Lifts an image out of the page so it can be moved, resized, replaced or deleted. */
  const convertImage = async (img: ImageTarget) => {
    const st = useStore.getState();
    setHover(null);
    let stored;
    try {
      stored = await loadImage(await renderImageTarget(page, img));
    } catch (err) {
      console.error(err);
      st.toast("This image couldn't be picked up for editing.", 'error');
      return;
    }
    const ann: ImageAnn = {
      id: uid('ann'),
      type: 'image',
      x: img.box.x,
      y: img.box.y,
      w: img.box.w,
      h: img.box.h,
      imageId: stored.id,
      opacity: 1,
      source: { name: img.name, inline: img.inline, matrixBase: img.matrixBase, box0: img.box },
    };
    st.commit((s) => ({
      ...s,
      removed: { ...s.removed, [page.id]: [...(s.removed[page.id] ?? []), img.id] },
      annotations: { ...s.annotations, [page.id]: [...(s.annotations[page.id] ?? []), ann] },
    }));
    st.select({ pageId: page.id, annId: ann.id });
  };

  // ----- Pointer interaction -----
  const toBase = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = outerRef.current!.getBoundingClientRect();
    return displayToBase((e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom, page);
  };
  const findAnn = (id: string) => useStore.getState().present.annotations[page.id]?.find((a) => a.id === id);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    if (target.closest('textarea')) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.tagName === 'TEXTAREA' || active?.tagName === 'INPUT') active.blur();

    const st = useStore.getState();
    st.setActivePage(page.id);
    const [x, y] = toBase(e);
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    const annId = target.closest('[data-ann-id]')?.getAttribute('data-ann-id') ?? null;
    const capture = () => outerRef.current?.setPointerCapture(e.pointerId);
    const s = st.style;
    if (textSel) setTextSel(null);

    // Cropping an image: drag the window or its corners; clicking elsewhere finishes.
    if (crop) {
      const cropHandle = target.closest('[data-crop-handle]')?.getAttribute('data-crop-handle') as 'move' | Handle | null;
      const ann = findAnn(crop.annId) as ImageAnn | undefined;
      if (cropHandle && ann) {
        drag.current = { kind: 'crop', annId: '', mode: cropHandle, sx: x, sy: y, start: { ...crop.draft }, full: fullImageBox(ann) };
        capture();
      } else applyCrop();
      return;
    }

    if (tool === 'note') {
      const existing = annId ? findAnn(annId) : undefined;
      if (existing) {
        st.select({ pageId: page.id, annId: existing.id });
        if (!isAnchored(existing)) {
          st.beginGesture();
          drag.current = { kind: 'move', annId: existing.id, sx: x, sy: y, orig: existing };
          capture();
        }
        return;
      }
      st.select(null);
      {
        const now = new Date().toISOString();
        const note: NoteAnn = {
          id: uid('ann'),
          type: 'note',
          x: x - 4,
          y: y - NOTE_SIZE + 4,
          color: '#FFE45C',
          text: '',
          author: st.author,
          created: now,
          modified: now,
          opacity: 1,
        };
        st.addAnnotation(page.id, note);
        st.setTool('select');
        st.select({ pageId: page.id, annId: note.id });
        st.setRightPanel('properties');
        st.setFocusNote(note.id);
      }
      return;
    }

    if (tool === 'select' || tool === 'edit') {
      const sel = st.selection?.pageId === page.id ? st.selection.annId : null;
      if (handle && sel) {
        const orig = findAnn(sel);
        if (!orig) return;
        st.beginGesture();
        drag.current =
          handle === 'p1' || handle === 'p2'
            ? { kind: 'endpoint', annId: sel, which: handle === 'p1' ? 1 : 2 }
            : { kind: 'resize', annId: sel, handle: handle as Handle, orig, box: annBox(orig) };
        capture();
      } else if (annId) {
        const orig = findAnn(annId);
        if (!orig) return;
        // A plain click on text opens it for typing: always in Edit mode,
        // or when it was already selected with the Select tool.
        const editOnClick = orig.type === 'text' && (tool === 'edit' || st.selection?.annId === annId);
        st.select({ pageId: page.id, annId });
        if (!isAnchored(orig)) {
          st.beginGesture();
          drag.current = { kind: 'move', annId, sx: x, sy: y, orig, editOnClick };
          capture();
        }
      } else if (tool === 'edit') {
        const hit = hitTarget(x, y);
        if (hit?.kind === 'text') convertSegment(hit.seg);
        else if (hit?.kind === 'ocr') convertOcrLine(hit.line);
        else if (hit?.kind === 'image') convertImage(hit.img);
        else st.select(null);
      } else {
        // Empty space with the Select tool: start selecting text.
        st.select(null);
        drag.current = { kind: 'textsel', annId: '', sx: x, sy: y };
        setSelecting(true);
        capture();
      }
      if (drag.current && (drag.current.kind === 'move' || drag.current.kind === 'resize')) setDraggingId(drag.current.annId);
      return;
    }

    if (tool === 'text') {
      const existing = annId ? findAnn(annId) : undefined;
      if (existing?.type === 'text') {
        st.setTool('select');
        st.select({ pageId: page.id, annId: existing.id });
        st.setEditingText(existing.id);
        return;
      }
      const ann: TextAnn = {
        id: uid('ann'),
        type: 'text',
        // Put the click roughly in the middle of the first line, along the text's own axis.
        x: x + s.fontSize * 0.6 * Math.sin((-page.rotation * Math.PI) / 180),
        y: y - s.fontSize * 0.6 * Math.cos((-page.rotation * Math.PI) / 180),
        text: '',
        fontSize: s.fontSize,
        font: s.font,
        bold: false,
        italic: false,
        color: s.color,
        opacity: s.opacity,
        angle: -page.rotation,
      };
      st.setTool('select');
      st.beginGesture();
      st.addAnnotation(page.id, ann, { live: true });
      st.select({ pageId: page.id, annId: ann.id });
      st.setEditingText(ann.id);
      return;
    }

    if (tool === 'image' || tool === 'signature') {
      const imgId = st.pendingImage;
      const img = imgId ? st.images[imgId] : null;
      if (!img) {
        st.toast(tool === 'signature' ? 'Create a signature first.' : 'Choose an image first.');
        return;
      }
      const [w, h] = placeSize(img);
      setGhost(null);
      st.setTool('select');
      st.setPendingImage(null);
      rotatedImage(img, page.rotation).then((placed) => {
        const ann: ImageAnn = { id: uid('ann'), type: 'image', x: x - w / 2, y: y - h / 2, w, h, imageId: placed.id, opacity: 1 };
        st.addAnnotation(page.id, ann);
        st.select({ pageId: page.id, annId: ann.id });
      });
      return;
    }

    st.beginGesture();
    if (tool === 'draw' || tool === 'highlighter') {
      const hl = tool === 'highlighter';
      const ann: InkAnn = {
        id: uid('ann'),
        type: 'ink',
        points: [x, y],
        color: hl ? s.highlightColor : s.color,
        width: hl ? Math.max(8, s.strokeWidth * 4) : s.strokeWidth,
        highlighter: hl,
        opacity: hl ? 0.6 : s.opacity,
      };
      st.addAnnotation(page.id, ann, { live: true });
      drag.current = { kind: 'ink', annId: ann.id };
    } else if (tool === 'line' || tool === 'arrow') {
      const ann: LineAnn = { id: uid('ann'), type: tool, x1: x, y1: y, x2: x, y2: y, color: s.color, width: s.strokeWidth, opacity: s.opacity };
      st.addAnnotation(page.id, ann, { live: true });
      drag.current = { kind: 'create', annId: ann.id, sx: x, sy: y };
    } else {
      const kind = tool as RectAnn['type'];
      const ann: RectAnn = {
        id: uid('ann'),
        type: kind,
        x,
        y,
        w: 0,
        h: 0,
        stroke: kind === 'rect' || kind === 'ellipse' ? s.color : null,
        fill: kind === 'highlight' ? s.highlightColor : kind === 'whiteout' ? '#FFFFFF' : s.fill,
        strokeWidth: kind === 'rect' || kind === 'ellipse' ? s.strokeWidth : 0,
        opacity: kind === 'highlight' || kind === 'whiteout' ? 1 : s.opacity,
      };
      st.addAnnotation(page.id, ann, { live: true });
      drag.current = { kind: 'create', annId: ann.id, sx: x, sy: y };
    }
    capture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (placing) setGhost(toBase(e));
      if (tool === 'select' && layout) {
        const onAnn = (e.target as Element).closest('[data-ann-id], [data-handle]');
        const [x, y] = toBase(e);
        const over = !onAnn && isOverText(layout, x, y);
        if (over !== overText) setOverText(over);
      }
      if (editTargets) {
        const onAnn = (e.target as Element).closest('[data-ann-id], [data-handle]');
        const [x, y] = toBase(e);
        const hit = onAnn ? null : hitTarget(x, y);
        const id = hit ? (hit.kind === 'text' ? hit.seg.id : hit.kind === 'ocr' ? hit.line.id : hit.img.id) : null;
        if (id !== hover) setHover(id);
      }
      return;
    }
    const [x, y] = toBase(e);
    const st = useStore.getState();
    if (d.kind === 'textsel') {
      if (layout) setTextSel(selectBetween(layout, d.sx, d.sy, x, y));
      return;
    }
    if (d.kind === 'crop') {
      const c = st.cropping;
      if (!c) return;
      const dx = x - d.sx,
        dy = y - d.sy;
      const F = d.full,
        S = d.start;
      const min = 8;
      let { x: nx, y: ny, w: nw, h: nh } = S;
      if (d.mode === 'move') {
        nx = Math.min(Math.max(S.x + dx, F.x), F.x + F.w - S.w);
        ny = Math.min(Math.max(S.y + dy, F.y), F.y + F.h - S.h);
      } else {
        let left = S.x,
          top = S.y,
          right = S.x + S.w,
          bottom = S.y + S.h;
        if (d.mode.includes('w')) left = Math.min(Math.max(S.x + dx, F.x), right - min);
        if (d.mode.includes('e')) right = Math.max(Math.min(S.x + S.w + dx, F.x + F.w), left + min);
        if (d.mode.includes('n')) top = Math.min(Math.max(S.y + dy, F.y), bottom - min);
        if (d.mode.includes('s')) bottom = Math.max(Math.min(S.y + S.h + dy, F.y + F.h), top + min);
        nx = left;
        ny = top;
        nw = right - left;
        nh = bottom - top;
      }
      st.setCropping({ ...c, draft: { x: nx, y: ny, w: nw, h: nh } });
      return;
    }
    const upd = (fn: (a: Annotation) => Annotation) => st.updateAnnotation(page.id, d.annId, fn, { live: true });

    switch (d.kind) {
      case 'move':
        // Ignore tiny jitters so a click doesn't nudge the item.
        if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 3 / zoom) break;
        d.moved = true;
        upd(() => moveAnn(d.orig, x - d.sx, y - d.sy));
        break;
      case 'resize': {
        const b = d.box;
        const fx = d.handle.includes('w') ? b.x + b.w : b.x;
        const fy = d.handle.includes('n') ? b.y + b.h : b.y;
        let w = Math.max(4, Math.abs(x - fx));
        let h = Math.max(4, Math.abs(y - fy));
        const keepAspect = d.orig.type === 'text' || (d.orig.type === 'image' && !e.shiftKey) || (e.shiftKey && d.orig.type !== 'image');
        if (keepAspect && b.w && b.h) {
          const ratio = b.w / b.h;
          if (w / h > ratio) h = w / ratio;
          else w = h * ratio;
        }
        const nx = x < fx ? fx - w : fx;
        const ny = y < fy ? fy - h : fy;
        upd(() => resizeAnn(d.orig, b, { x: nx, y: ny, w, h }));
        break;
      }
      case 'endpoint':
        upd((a) => (d.which === 1 ? { ...(a as LineAnn), x1: x, y1: y } : { ...(a as LineAnn), x2: x, y2: y }));
        break;
      case 'ink':
        upd((a) => {
          const ink = a as InkAnn;
          const n = ink.points.length;
          if (Math.hypot(x - ink.points[n - 2], y - ink.points[n - 1]) < 0.75 / zoom) return a;
          return { ...ink, points: [...ink.points, x, y] };
        });
        break;
      case 'create':
        upd((a) => {
          if (a.type === 'line' || a.type === 'arrow') {
            let x2 = x,
              y2 = y;
            if (e.shiftKey) {
              const ang = Math.round(Math.atan2(y - d.sy, x - d.sx) / (Math.PI / 4)) * (Math.PI / 4);
              const len = Math.hypot(x - d.sx, y - d.sy);
              x2 = d.sx + len * Math.cos(ang);
              y2 = d.sy + len * Math.sin(ang);
            }
            return { ...a, x2, y2 };
          }
          let w = Math.abs(x - d.sx);
          let h = Math.abs(y - d.sy);
          if (e.shiftKey) w = h = Math.max(w, h);
          return { ...(a as RectAnn), x: x < d.sx ? d.sx - w : d.sx, y: y < d.sy ? d.sy - h : d.sy, w, h };
        });
        break;
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDraggingId(null);
    if (d.kind === 'textsel' || d.kind === 'crop') {
      setSelecting(false);
      return;
    }
    const st = useStore.getState();
    const a = findAnn(d.annId);
    if (d.kind === 'create' && a) {
      const box = annBox(a);
      const tiny = a.type === 'line' || a.type === 'arrow' ? Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 3 : box.w < 3 || box.h < 3;
      if (tiny) {
        // Discard accidental clicks without leaving a history entry.
        const base = st.gestureBase;
        if (base) st.live(() => base);
      }
    }
    if (d.kind === 'ink' && a?.type === 'ink') {
      st.updateAnnotation(page.id, a.id, () => ({ ...a, points: simplify(a.points, 0.4) }), { live: true });
    }
    st.endGesture();
    if (d.kind === 'move' && !d.moved && d.editOnClick && a?.type === 'text') st.setEditingText(a.id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'select' && tool !== 'edit') return;
    const annId = (e.target as Element).closest('[data-ann-id]')?.getAttribute('data-ann-id');
    const a = annId ? findAnn(annId) : undefined;
    if (a?.type === 'text') {
      useStore.getState().select({ pageId: page.id, annId: a.id });
      useStore.getState().setEditingText(a.id);
    } else if (a?.type === 'image') {
      startCrop(page.id, a.id);
    }
  };

  const selected = selectedId ? annotations.find((a) => a.id === selectedId) : undefined;
  const editing = editingText ? annotations.find((a) => a.id === editingText && a.type === 'text') : undefined;
  const hs = 9 / zoom;

  // Base-orientation layer, rotated into place.
  const baseW = page.width * zoom;
  const baseH = page.height * zoom;
  const layerStyle: React.CSSProperties = {
    width: baseW,
    height: baseH,
    left: (disp.width * zoom - baseW) / 2,
    top: (disp.height * zoom - baseH) / 2,
    transform: `rotate(${page.rotation}deg)`,
  };

  return (
    <div
      ref={outerRef}
      className="page"
      data-page-id={page.id}
      data-tool={tool}
      style={{
        width: disp.width * zoom,
        height: disp.height * zoom,
        cursor: hover ? (editTargets?.images.some((i) => i.id === hover) ? 'move' : 'text') : overText ? 'text' : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (ghost) setGhost(null);
        if (hover) setHover(null);
        if (overText) setOverText(false);
      }}
      onDoubleClick={onDoubleClick}
      onMouseDown={(e) => {
        if (!(e.target as Element).closest('textarea')) e.preventDefault();
        // Double-click selects a word, triple-click a line (like any document).
        if (tool === 'select' && e.detail >= 2 && layout && !(e.target as Element).closest('[data-ann-id], [data-handle]')) {
          const [x, y] = toBase(e);
          const sel = e.detail === 2 ? selectWord(layout, x, y) : selectLine(layout, x, y);
          if (sel) {
            drag.current = null;
            setSelecting(false);
            setTextSel(sel);
          }
        }
      }}
      aria-label={`Page ${index + 1}`}
    >
      <div className="page-layer" style={layerStyle}>
        {renderSrc && <canvas ref={canvasRef} className="page-canvas" style={{ width: baseW, height: baseH }} />}
        {page.docId && !rendered && <div className="page-loading" />}
        <svg className="page-svg" viewBox={`0 0 ${page.width} ${page.height}`} width={baseW} height={baseH}>
          {editTargets && (
            <g className="edit-targets">
              {editTargets.segments.map((sg) => (
                <rect key={sg.id} className={`edit-target ${hover === sg.id ? 'is-hover' : ''}`} x={sg.box.x - 1} y={sg.box.y - 1} width={sg.box.w + 2} height={sg.box.h + 2} strokeWidth={1 / zoom} />
              ))}
              {editTargets.ocr.map((l) => (
                <rect key={l.id} className={`edit-target edit-ocr ${hover === l.id ? 'is-hover' : ''}`} x={l.box.x - 1} y={l.box.y - 1} width={l.box.w + 2} height={l.box.h + 2} strokeWidth={1 / zoom} />
              ))}
              {editTargets.images.map((im) => (
                <rect key={im.id} className={`edit-target edit-image ${hover === im.id ? 'is-hover' : ''}`} x={im.box.x} y={im.box.y} width={im.box.w} height={im.box.h} strokeWidth={1.5 / zoom} />
              ))}
            </g>
          )}
          {fileNotes.map((c) => (
            <g key={c.key} className="file-note">
              <title>{`${c.author ? c.author + ': ' : ''}${c.note}`}</title>
              <NoteIcon x={c.box.x} y={c.box.y} size={Math.max(14, Math.min(c.box.w, c.box.h, 24))} color={c.color ?? '#FFE45C'} />
            </g>
          ))}
          <AnnotationShapes annotations={annotations} images={images} hiddenId={editing?.id ?? crop?.annId} ghostId={draggingId} interactive scale={zoom} />
          {selected && !editing && !crop && <SelectionFrame ann={selected} hs={hs} />}
          {find?.matches.map((m, i) =>
            m.pageId === page.id
              ? m.boxes.map((b, k) => (
                  <rect key={`f${i}-${k}`} className={`find-hit ${i === find.current ? 'is-current' : ''}`} x={b.x - 1} y={b.y - 1} width={b.w + 2} height={b.h + 2} strokeWidth={1.5 / zoom} />
                ))
              : null,
          )}
          {textSel?.quads.map((q, i) => <rect key={`s${i}`} className="text-sel" x={q.x} y={q.y} width={q.w} height={q.h} />)}
          {crop && (() => {
            const ann = annotations.find((a) => a.id === crop.annId) as ImageAnn | undefined;
            const img = ann && images[ann.imageId];
            if (!ann || !img) return null;
            const full = fullImageBox(ann);
            const d = crop.draft;
            return (
              <g className="crop-ui">
                <image href={img.url} x={full.x} y={full.y} width={full.w} height={full.h} opacity={0.3} preserveAspectRatio="none" />
                <svg x={d.x} y={d.y} width={d.w} height={d.h} viewBox={`${d.x} ${d.y} ${d.w} ${d.h}`} overflow="hidden">
                  <image href={img.url} x={full.x} y={full.y} width={full.w} height={full.h} preserveAspectRatio="none" />
                </svg>
                <rect className="crop-frame" data-crop-handle="move" x={d.x} y={d.y} width={d.w} height={d.h} strokeWidth={1.5 / zoom} />
                {(['nw', 'ne', 'sw', 'se'] as Handle[]).map((h) => (
                  <rect
                    key={h}
                    data-crop-handle={h}
                    className={`crop-handle h-${h}`}
                    x={(h.includes('w') ? d.x : d.x + d.w) - hs / 1.4}
                    y={(h.includes('n') ? d.y : d.y + d.h) - hs / 1.4}
                    width={hs * 1.4}
                    height={hs * 1.4}
                    strokeWidth={hs / 6}
                  />
                ))}
              </g>
            );
          })()}
          {placing && ghost && pendingImage && (() => {
            const [w, h] = placeSize(pendingImage);
            // Draw the un-rotated image, then turn it so it reads upright on screen.
            const swap = page.rotation % 180 !== 0;
            const [gw, gh] = swap ? [h, w] : [w, h];
            return (
              <image
                className="place-ghost"
                href={pendingImage.url}
                x={ghost[0] - gw / 2}
                y={ghost[1] - gh / 2}
                width={gw}
                height={gh}
                preserveAspectRatio="none"
                transform={page.rotation ? `rotate(${-page.rotation} ${ghost[0]} ${ghost[1]})` : undefined}
              />
            );
          })()}
        </svg>
        {editing && <TextEditor pageId={page.id} ann={editing as TextAnn} zoom={zoom} />}
      </div>
      {textSel && !selecting && (() => {
        // Toolbar under the end of the selection, in screen orientation.
        const q = textSel.quads[textSel.quads.length - 1];
        const [dx, dy] = baseToDisplay(q.x + q.w, q.y + q.h, page);
        const left = Math.min(Math.max(dx * zoom - 100, 4), disp.width * zoom - 210);
        const top = Math.min(dy * zoom + 8, disp.height * zoom - 44);
        return (
          <div className="sel-toolbar" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            <button title="Highlight" aria-label="Highlight" onClick={() => addMarkup('highlight', false)}>
              <Highlighter size={16} />
            </button>
            <button title="Underline" aria-label="Underline" onClick={() => addMarkup('underline', false)}>
              <Underline size={16} />
            </button>
            <button title="Strike out" aria-label="Strike out" onClick={() => addMarkup('strikeout', false)}>
              <Strikethrough size={16} />
            </button>
            <button title="Highlight and add a note" aria-label="Add note" onClick={() => addMarkup('highlight', true)}>
              <MessageSquarePlus size={16} />
            </button>
            <button
              title="Copy text"
              aria-label="Copy text"
              onClick={() => {
                navigator.clipboard?.writeText(textSel.text).then(
                  () => useStore.getState().toast('Copied.'),
                  () => useStore.getState().toast("Couldn't copy to the clipboard.", 'error'),
                );
                setTextSel(null);
              }}
            >
              <Copy size={16} />
            </button>
          </div>
        );
      })()}
    </div>
  );
});

function SelectionFrame({ ann, hs }: { ann: Annotation; hs: number }) {
  if (ann.type === 'line' || ann.type === 'arrow') {
    return (
      <g className="sel">
        {([
          ['p1', ann.x1, ann.y1],
          ['p2', ann.x2, ann.y2],
        ] as const).map(([h, x, y]) => (
          <circle key={h} data-handle={h} className="sel-handle" cx={x} cy={y} r={hs / 1.6} strokeWidth={hs / 6} />
        ))}
      </g>
    );
  }
  const b = annBox(ann);
  const pad = hs / 3;
  if (ann.type === 'note' || isAnchored(ann)) {
    return (
      <g className="sel">
        <rect className="sel-frame" x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} strokeWidth={hs / 6} strokeDasharray={`${hs / 2} ${hs / 3}`} />
      </g>
    );
  }
  const box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const corners: [Handle, number, number][] = [
    ['nw', box.x, box.y],
    ['ne', box.x + box.w, box.y],
    ['sw', box.x, box.y + box.h],
    ['se', box.x + box.w, box.y + box.h],
  ];
  return (
    <g className="sel">
      <rect className="sel-frame" x={box.x} y={box.y} width={box.w} height={box.h} strokeWidth={hs / 6} strokeDasharray={`${hs / 2} ${hs / 3}`} />
      {corners.map(([h, x, y]) => (
        <rect
          key={h}
          data-handle={h}
          className={`sel-handle h-${h}`}
          x={x - hs / 2}
          y={y - hs / 2}
          width={hs}
          height={hs}
          strokeWidth={hs / 6}
        />
      ))}
    </g>
  );
}
