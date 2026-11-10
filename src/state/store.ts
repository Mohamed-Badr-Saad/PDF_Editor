import { create } from 'zustand';
import type { Annotation, OcrPage, PageItem, Rotation, SourceDoc, StoredImage, Tool, ToolStyle } from '../lib/types';
import { normalizeRotation } from '../lib/geometry';

const PANELS_KEY = 'pagecraft.panels';
/** Phones and small tablets show the side panels as slide-over drawers. */
export const isNarrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches;
function loadPanels(): { left: boolean; right: boolean } {
  // Drawers start closed on small screens so the page gets the whole width.
  if (isNarrow()) return { left: false, right: false };
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? 'null');
    if (v && typeof v.left === 'boolean' && typeof v.right === 'boolean') return v;
  } catch {
    /* ignore */
  }
  return { left: true, right: true };
}

/** The part of the state that undo/redo tracks. */
export interface DocState {
  pages: PageItem[];
  annotations: Record<string, Annotation[]>;
  /** Original PDF content removed per page: "op.glyph" (text) or "op" (image) ids. */
  removed: Record<string, string[]>;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface Selection {
  pageId: string;
  annId: string;
}

interface Store {
  fileName: string;
  docs: Record<string, SourceDoc>;
  images: Record<string, StoredImage>;
  /** OCR results by ocrKey(page); kept outside undo history. */
  ocr: Record<string, OcrPage>;
  present: DocState;
  past: DocState[];
  future: DocState[];
  /** Snapshot taken at the start of a drag/draw gesture. */
  gestureBase: DocState | null;
  dirty: boolean;

  tool: Tool;
  style: ToolStyle;
  zoom: number;
  selectedPages: string[];
  selection: Selection | null;
  editingText: string | null;
  activePageId: string | null;
  scrollRequest: { pageId: string; nonce: number } | null;
  pendingImage: string | null;
  toasts: Toast[];
  busy: string | null;
  dialog: DialogName | null;
  rightPanel: 'properties' | 'comments';
  /** Which side panels are unfolded (pages on the left, properties/comments on the right). */
  panels: { left: boolean; right: boolean };
  setPanelOpen(side: 'left' | 'right', open: boolean): void;
  /** Name written into comments. */
  author: string;
  find: FindState | null;
  /** Image being cropped, with the visible box as currently dragged. */
  cropping: { pageId: string; annId: string; draft: { x: number; y: number; w: number; h: number } } | null;
  /** Comment whose note field should receive focus. */
  focusNote: string | null;
  /** Text currently selected on a page (for copy and markup). */
  textSel: { pageId: string; quads: { x: number; y: number; w: number; h: number }[]; text: string } | null;
  /** Request from Ctrl+A to select all text on a page. */
  selectAllRequest: { pageId: string; nonce: number } | null;
  /** The Unicode web font finished loading (text widths change). */
  fontsReady: boolean;
  /** Pages that look like scans (no text, mostly a picture), by page id. */
  scanPages: string[];
  /** The "these pages are scans" banner was closed for this document. */
  scanBannerClosed: boolean;
  /** Item copied with Ctrl+C, pasted with Ctrl+V. */
  clipboard: { ann: Annotation; pageId: string } | null;

  // history
  commit(fn: (s: DocState) => DocState): void;
  beginGesture(): void;
  live(fn: (s: DocState) => DocState): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  reset(): void;

  // registries
  addDoc(doc: SourceDoc): void;
  addImage(img: StoredImage): void;
  setOcr(key: string, result: OcrPage): void;
  setFileName(n: string): void;
  markSaved(): void;

  // pages
  insertPages(pages: PageItem[], at?: number): void;
  rotatePages(ids: string[], delta: number): void;
  deletePages(ids: string[]): void;
  duplicatePages(ids: string[]): void;
  movePages(ids: string[], toIndex: number): void;

  // annotations
  addAnnotation(pageId: string, ann: Annotation, opts?: { live?: boolean }): void;
  updateAnnotation(pageId: string, annId: string, fn: (a: Annotation) => Annotation, opts?: { live?: boolean }): void;
  removeAnnotation(pageId: string, annId: string): void;
  addAnnotationsToPages(make: (p: PageItem) => Annotation | null, pageIds?: string[]): void;

  // ui
  setTool(t: Tool): void;
  setStyle(patch: Partial<ToolStyle>): void;
  setZoom(z: number): void;
  setSelectedPages(ids: string[]): void;
  select(sel: Selection | null): void;
  setEditingText(id: string | null): void;
  setActivePage(id: string | null): void;
  scrollToPage(id: string): void;
  setPendingImage(id: string | null): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setBusy(msg: string | null): void;
  openDialog(d: DialogName | null): void;
  setRightPanel(p: 'properties' | 'comments'): void;
  setAuthor(name: string): void;
  setFind(f: FindState | null): void;
  setCropping(c: Store['cropping']): void;
  setFocusNote(id: string | null): void;
  setTextSel(sel: Store['textSel']): void;
  requestSelectAll(pageId: string): void;
  setClipboard(c: Store['clipboard']): void;
  reorderAnnotation(pageId: string, annId: string, to: 'front' | 'back'): void;
}

export interface FindMatch {
  pageId: string;
  boxes: { x: number; y: number; w: number; h: number }[];
}
export interface FindState {
  query: string;
  matches: FindMatch[];
  current: number;
  searching: boolean;
}

const AUTHOR_KEY = 'pagecraft.author';
function loadAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export type DialogName = 'signature' | 'watermark' | 'pagenumbers' | 'ocr' | 'about';

let uidCounter = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${(uidCounter++).toString(36)}`;

const MAX_HISTORY = 100;
const emptyDoc: DocState = { pages: [], annotations: {}, removed: {} };
let toastId = 0;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export const useStore = create<Store>((set, get) => {
  const mapPage = (pageId: string, fn: (list: Annotation[]) => Annotation[]) => (s: DocState): DocState => ({
    ...s,
    annotations: { ...s.annotations, [pageId]: fn(s.annotations[pageId] ?? []) },
  });

  return {
    fileName: 'document.pdf',
    docs: {},
    images: {},
    ocr: {},
    present: emptyDoc,
    past: [],
    future: [],
    gestureBase: null,
    dirty: false,

    tool: 'select',
    style: { color: '#1B2A41', strokeWidth: 2, fontSize: 14, font: 'Helvetica', fill: null, opacity: 1, highlightColor: '#FFE45C' },
    zoom: 1,
    selectedPages: [],
    selection: null,
    editingText: null,
    activePageId: null,
    scrollRequest: null,
    pendingImage: null,
    toasts: [],
    busy: null,
    dialog: null,
    rightPanel: 'properties',
    panels: loadPanels(),
    author: loadAuthor(),
    find: null,
    cropping: null,
    focusNote: null,
    textSel: null,
    selectAllRequest: null,
    clipboard: null,
    fontsReady: false,
    scanPages: [],
    scanBannerClosed: false,

    commit(fn) {
      const { present, past } = get();
      const next = fn(present);
      if (next === present) return;
      set({ present: next, past: [...past, present].slice(-MAX_HISTORY), future: [], dirty: true });
    },
    beginGesture() {
      set({ gestureBase: get().present });
    },
    live(fn) {
      set({ present: fn(get().present) });
    },
    endGesture() {
      const { gestureBase, present, past } = get();
      if (gestureBase && gestureBase !== present) {
        set({ past: [...past, gestureBase].slice(-MAX_HISTORY), future: [], dirty: true });
      }
      set({ gestureBase: null });
    },
    undo() {
      const { past, present, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ present: prev, past: past.slice(0, -1), future: [present, ...future], selection: null, editingText: null, dirty: true });
      pruneSelection();
    },
    redo() {
      const { past, present, future } = get();
      if (!future.length) return;
      set({ present: future[0], past: [...past, present], future: future.slice(1), selection: null, editingText: null, dirty: true });
      pruneSelection();
    },
    reset() {
      Object.values(get().images).forEach((i) => URL.revokeObjectURL(i.url));
      set({
        docs: {},
        images: {},
        ocr: {},
        present: emptyDoc,
        past: [],
        future: [],
        selectedPages: [],
        selection: null,
        editingText: null,
        activePageId: null,
        dirty: false,
        fileName: 'document.pdf',
        tool: 'select',
        find: null,
        cropping: null,
        textSel: null,
        scanPages: [],
        scanBannerClosed: false,
      });
    },

    addDoc(doc) {
      set({ docs: { ...get().docs, [doc.id]: doc } });
    },
    addImage(img) {
      set({ images: { ...get().images, [img.id]: img } });
    },
    setOcr(key, result) {
      set({ ocr: { ...get().ocr, [key]: result } });
    },
    setFileName(n) {
      set({ fileName: n });
    },
    markSaved() {
      set({ dirty: false });
    },

    insertPages(pages, at) {
      get().commit((s) => {
        const list = [...s.pages];
        list.splice(at ?? list.length, 0, ...pages);
        return { ...s, pages: list };
      });
    },
    rotatePages(ids, delta) {
      const set_ = new Set(ids);
      get().commit((s) => ({
        ...s,
        pages: s.pages.map((p) => (set_.has(p.id) ? { ...p, rotation: normalizeRotation(p.rotation + delta) as Rotation } : p)),
      }));
    },
    deletePages(ids) {
      const set_ = new Set(ids);
      get().commit((s) => {
        const annotations = { ...s.annotations };
        const removed = { ...s.removed };
        ids.forEach((id) => {
          delete annotations[id];
          delete removed[id];
        });
        return { pages: s.pages.filter((p) => !set_.has(p.id)), annotations, removed };
      });
      set({ selectedPages: get().selectedPages.filter((id) => !set_.has(id)) });
      pruneSelection();
    },
    duplicatePages(ids) {
      const set_ = new Set(ids);
      get().commit((s) => {
        const pages: PageItem[] = [];
        const annotations = { ...s.annotations };
        const removed = { ...s.removed };
        for (const p of s.pages) {
          pages.push(p);
          if (set_.has(p.id)) {
            const copy = { ...p, id: uid('page') };
            pages.push(copy);
            annotations[copy.id] = (s.annotations[p.id] ?? []).map((a) => ({ ...a, id: uid('ann') }));
            if (s.removed[p.id]) removed[copy.id] = [...s.removed[p.id]];
          }
        }
        return { pages, annotations, removed };
      });
    },
    movePages(ids, toIndex) {
      get().commit((s) => {
        const set_ = new Set(ids);
        const moving = s.pages.filter((p) => set_.has(p.id));
        // Translate target index into the list without the moving pages.
        const before = s.pages.slice(0, toIndex).filter((p) => !set_.has(p.id)).length;
        const rest = s.pages.filter((p) => !set_.has(p.id));
        rest.splice(before, 0, ...moving);
        if (rest.every((p, i) => p === s.pages[i])) return s;
        return { ...s, pages: rest };
      });
    },

    addAnnotation(pageId, ann, opts) {
      const fn = mapPage(pageId, (l) => [...l, ann]);
      if (opts?.live) get().live(fn);
      else get().commit(fn);
    },
    updateAnnotation(pageId, annId, fn, opts) {
      const upd = mapPage(pageId, (l) => l.map((a) => (a.id === annId ? fn(a) : a)));
      if (opts?.live) get().live(upd);
      else get().commit(upd);
    },
    removeAnnotation(pageId, annId) {
      get().commit(mapPage(pageId, (l) => l.filter((a) => a.id !== annId)));
      const sel = get().selection;
      if (sel?.annId === annId) set({ selection: null, editingText: null });
    },
    addAnnotationsToPages(make, pageIds) {
      get().commit((s) => {
        const annotations = { ...s.annotations };
        const only = pageIds ? new Set(pageIds) : null;
        for (const p of s.pages) {
          if (only && !only.has(p.id)) continue;
          const a = make(p);
          if (a) annotations[p.id] = [...(annotations[p.id] ?? []), a];
        }
        return { ...s, annotations };
      });
    },

    setTool(t) {
      set({ tool: t, editingText: null, cropping: null, textSel: null, selection: t === 'select' ? get().selection : null });
    },
    setStyle(patch) {
      set({ style: { ...get().style, ...patch } });
    },
    setZoom(z) {
      set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100)) });
    },
    setSelectedPages(ids) {
      set({ selectedPages: ids });
    },
    select(sel) {
      set({ selection: sel, editingText: sel && get().editingText === sel.annId ? sel.annId : null, ...(sel ? { textSel: null } : {}) });
    },
    setEditingText(id) {
      set({ editingText: id });
    },
    setActivePage(id) {
      if (get().activePageId !== id) set({ activePageId: id });
    },
    scrollToPage(id) {
      set({ scrollRequest: { pageId: id, nonce: Date.now() } });
    },
    setPendingImage(id) {
      set({ pendingImage: id });
    },
    toast(text, kind = 'info') {
      const id = ++toastId;
      // The same message twice in a row replaces the old one instead of stacking.
      set({ toasts: [...get().toasts.filter((t) => t.text !== text).slice(-2), { id, text, kind }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },
    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    setBusy(msg) {
      set({ busy: msg });
    },
    openDialog(d) {
      set({ dialog: d });
    },
    setRightPanel(p) {
      set({ rightPanel: p });
      if (p === 'comments') get().setPanelOpen('right', true);
    },
    setPanelOpen(side, open) {
      const panels = { ...get().panels, [side]: open };
      set({ panels });
      if (isNarrow()) return; // drawer state on phones isn't a lasting preference
      try {
        localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
      } catch {
        /* private mode */
      }
    },
    setAuthor(name) {
      set({ author: name });
      try {
        localStorage.setItem(AUTHOR_KEY, name);
      } catch {
        /* not remembered */
      }
    },
    setFind(f) {
      set({ find: f });
    },
    setCropping(c) {
      set({ cropping: c });
      // Cropping is finished from the right panel, so make sure it's showing.
      if (c && !get().panels.right) get().setPanelOpen('right', true);
    },
    setFocusNote(id) {
      set({ focusNote: id });
    },
    setTextSel(sel) {
      set({ textSel: sel });
    },
    requestSelectAll(pageId) {
      set({ selectAllRequest: { pageId, nonce: Date.now() } });
    },
    setClipboard(c) {
      set({ clipboard: c });
    },
    reorderAnnotation(pageId, annId, to) {
      get().commit(
        mapPage(pageId, (l) => {
          const a = l.find((x) => x.id === annId);
          if (!a) return l;
          const rest = l.filter((x) => x.id !== annId);
          return to === 'front' ? [...rest, a] : [a, ...rest];
        }),
      );
    },
  };

  function pruneSelection() {
    const { selection, present } = get();
    if (selection && !(present.annotations[selection.pageId] ?? []).some((a) => a.id === selection.annId)) {
      set({ selection: null, editingText: null });
    }
  }
});

/** OCR results are shared by duplicates of the same source page. */
export const ocrKey = (p: PageItem) => (p.docId ? `${p.docId}:${p.srcIndex}` : p.id);

/** Convenience: find an annotation by selection. */
export function getSelectedAnnotation(): { pageId: string; ann: Annotation } | null {
  const { selection, present } = useStore.getState();
  if (!selection) return null;
  const ann = (present.annotations[selection.pageId] ?? []).find((a) => a.id === selection.annId);
  return ann ? { pageId: selection.pageId, ann } : null;
}
