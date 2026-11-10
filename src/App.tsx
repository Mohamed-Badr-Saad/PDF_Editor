import { useEffect, useState } from 'react';
import { useStore, getSelectedAnnotation, uid } from './state/store';
import { Welcome } from './components/Welcome';
import { Header, togglePanel } from './components/Header';
import { ToolRail, TOOL_KEYS, activateTool } from './components/ToolRail';
import { Sidebar } from './components/Sidebar';
import { Viewer } from './components/Viewer';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SignatureModal } from './components/SignatureModal';
import { PageNumbersDialog, WatermarkDialog } from './components/ToolDialogs';
import { AboutDialog } from './components/AboutDialog';
import { OcrDialog } from './components/OcrDialog';
import { CommentsPanel } from './components/CommentsPanel';
import { FindBar } from './components/FindBar';
import { applyCrop, cancelCrop } from './lib/crop';
import { Tooltip } from './components/Tooltip';
import { ScanBanner } from './components/ScanBanner';
import { detectScans } from './lib/scanDetect';
import { describeDrag, dropHint, handleDrop, type DragInfo } from './lib/dropFiles';
import type { Annotation, TextAnn } from './lib/types';
import { ACCEPT_ALL, importFiles, loadImage, pickFiles, rotatedImage } from './lib/importFiles';
import { saveDocument } from './lib/actions';
import { measureText, moveAnn } from './lib/geometry';
import type { ImageAnn } from './lib/types';

const CLIP_MIME = 'application/x-pagecraft-item';

/** The page the user is looking at. */
function activePage() {
  const st = useStore.getState();
  return st.present.pages.find((p) => p.id === st.activePageId) ?? st.present.pages[0];
}

function goToPage(delta: number | 'first' | 'last') {
  const st = useStore.getState();
  const pages = st.present.pages;
  if (!pages.length) return;
  const i = pages.findIndex((p) => p.id === st.activePageId);
  const target = delta === 'first' ? 0 : delta === 'last' ? pages.length - 1 : Math.min(pages.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
  st.scrollToPage(pages[target].id);
}


function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export default function App() {
  const hasPages = useStore((s) => s.present.pages.length > 0);
  const toasts = useStore((s) => s.toasts);
  const busy = useStore((s) => s.busy);
  const rightPanel = useStore((s) => s.rightPanel);
  const panels = useStore((s) => s.panels);
  const findOpen = useStore((s) => s.find !== null);
  const dialog = useStore((s) => s.dialog);
  const setDialog = useStore((s) => s.openDialog);
  const [drag, setDrag] = useState<DragInfo | null>(null);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveDocument();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        pickFiles(ACCEPT_ALL, false).then((f) => {
          if (f.length && (!st.dirty || confirm('Discard your unsaved changes and open another file?'))) importFiles(f, { replace: true });
        });
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (!st.find) st.setFind({ query: '', matches: [], current: 0, searching: false });
        else (document.querySelector('.find-bar input') as HTMLInputElement | null)?.focus();
        return;
      }
      if (isTyping(e) || dialog) return;
      if (st.cropping) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCrop();
        } else if (e.key === 'Escape') cancelCrop();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const p = activePage();
        if (p) {
          if (st.tool !== 'select') st.setTool('select');
          st.select(null);
          st.requestSelectAll(p.id);
        }
        return;
      }
      if (!mod && (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        goToPage(e.key === 'PageDown' ? 1 : e.key === 'PageUp' ? -1 : e.key === 'Home' ? 'first' : 'last');
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        st.setZoom(st.zoom * 1.2);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        st.setZoom(st.zoom / 1.2);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        st.setZoom(1);
        return;
      }
      const sel = getSelectedAnnotation();
      if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        st.removeAnnotation(sel.pageId, sel.ann.id);
        return;
      }
      if (sel && mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const copy = { ...moveAnn(sel.ann, 12, 12), id: uid('ann') };
        st.addAnnotation(sel.pageId, copy);
        st.select({ pageId: sel.pageId, annId: copy.id });
        return;
      }
      if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        // Arrow keys move in screen direction, so map through the page rotation.
        const page = st.present.pages.find((p) => p.id === sel.pageId);
        const r = page?.rotation ?? 0;
        const [bx, by] = r === 90 ? [dy, -dx] : r === 180 ? [-dx, -dy] : r === 270 ? [-dy, dx] : [dx, dy];
        st.updateAnnotation(sel.pageId, sel.ann.id, (a) => moveAnn(a, bx, by));
        return;
      }
      if (sel && e.key === 'Enter' && sel.ann.type === 'text') {
        e.preventDefault();
        st.setEditingText(sel.ann.id);
        return;
      }
      if (e.key === 'Escape') {
        if (st.textSel) st.setTextSel(null);
        else if (st.selection) st.select(null);
        else st.setTool('select');
        return;
      }
      if (!mod && !e.altKey && (e.key === '[' || e.key === ']') && st.present.pages.length) {
        togglePanel(e.key === '[' ? 'left' : 'right');
        return;
      }
      if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()] && st.present.pages.length) {
        activateTool(TOOL_KEYS[e.key.toLowerCase()], () => setDialog('signature'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, setDialog]);

  // Ctrl+C: copy selected text, or the selected item.
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e) || !e.clipboardData) return;
      const st = useStore.getState();
      if (st.textSel?.text) {
        e.clipboardData.setData('text/plain', st.textSel.text);
        e.preventDefault();
        st.toast('Copied.');
        return;
      }
      const sel = getSelectedAnnotation();
      if (sel) {
        st.setClipboard({ ann: sel.ann, pageId: sel.pageId });
        const text = sel.ann.type === 'text' ? sel.ann.text : sel.ann.type === 'note' ? sel.ann.text : sel.ann.type === 'markup' ? sel.ann.quotedText : '';
        e.clipboardData.setData('text/plain', text || ' ');
        e.clipboardData.setData(CLIP_MIME, sel.ann.id);
        e.preventDefault();
        st.toast('Copied. Press Ctrl+V to paste a copy.');
      }
    };
    const onCut = (e: ClipboardEvent) => {
      if (isTyping(e)) return;
      const sel = getSelectedAnnotation();
      if (!sel) return;
      onCopy(e);
      useStore.getState().removeAnnotation(sel.pageId, sel.ann.id);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
    };
  }, []);

  // Ctrl+V: paste an item copied here, an image, or plain text (as a text box).
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (isTyping(e)) return;
      const st = useStore.getState();
      const page = activePage();
      if (!page || !e.clipboardData) return;
      const place = (ann: Annotation) => {
        st.addAnnotation(page.id, ann);
        st.setTool('select');
        st.select({ pageId: page.id, annId: ann.id });
      };
      // An item copied inside PageCraft.
      if (e.clipboardData.types.includes(CLIP_MIME) && st.clipboard) {
        e.preventDefault();
        const { ann, pageId } = st.clipboard;
        const offset = pageId === page.id ? 14 : 0;
        const now = new Date().toISOString();
        let copy = { ...moveAnn(ann, offset, offset), id: uid('ann') } as Annotation;
        if (copy.type === 'note' || copy.type === 'markup') copy = { ...copy, created: now, modified: now };
        if (copy.type === 'text' && copy.source) copy = { ...copy, source: undefined } as TextAnn; // a pasted copy is ordinary text
        if (copy.type === 'image' && copy.source) copy = { ...copy, source: undefined };
        place(copy);
        return;
      }
      const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        const img = await rotatedImage(await loadImage(file), page.rotation);
        const w = Math.min(page.width * 0.5, img.width);
        const h = (img.height / img.width) * w;
        place({ id: uid('ann'), type: 'image', x: (page.width - w) / 2, y: (page.height - h) / 2, w, h, imageId: img.id, opacity: 1 } as ImageAnn);
        return;
      }
      const text = e.clipboardData.getData('text/plain').replace(/\r\n/g, '\n').trim();
      if (text) {
        e.preventDefault();
        const s = st.style;
        const base: TextAnn = {
          id: uid('ann'),
          type: 'text',
          x: 0,
          y: 0,
          text: text.slice(0, 5000),
          fontSize: s.fontSize,
          font: s.font,
          bold: false,
          italic: false,
          color: s.color,
          opacity: 1,
          angle: -page.rotation,
        };
        const { w, h } = measureText(base);
        place({ ...base, x: Math.max(20, (page.width - w) / 2), y: Math.max(20, (page.height - h) / 2) });
        st.toast('Pasted as a text box. Double-click it to edit.');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Look for scanned pages whenever the page list changes, to offer OCR right away.
  const pageList = useStore((s) => s.present.pages);
  useEffect(() => {
    if (!pageList.length) return;
    const t = setTimeout(detectScans, 400);
    return () => clearTimeout(t);
  }, [pageList]);

  // Warn before losing unsaved work.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Files opened via the installed app's file handler ("Open with PageCraft").
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async ({ files }) => {
      if (!files.length) return;
      const list = await Promise.all(files.map((h) => h.getFile()));
      importFiles(list, { replace: true });
    });
  }, []);

  const overlays = (
    <>
      {dialog === 'signature' && <SignatureModal onClose={() => setDialog(null)} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={() => setDialog(null)} />}
      {dialog === 'pagenumbers' && <PageNumbersDialog onClose={() => setDialog(null)} />}
      {dialog === 'ocr' && <OcrDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      <Tooltip />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );

  if (!hasPages) {
    return (
      <>
        <Welcome />
        {overlays}
      </>
    );
  }

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const info = describeDrag(e);
        // Only update when something changed (dragover fires constantly).
        setDrag((d) => (info && d && d.pageId === info.pageId && d.images === info.images && d.pdfs === info.pdfs ? d : info));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(null);
      }}
      onDrop={(e) => {
        setDrag(null);
        if (e.defaultPrevented || !e.dataTransfer.files.length) return;
        e.preventDefault();
        handleDrop(e);
      }}
    >
      <Header onWatermark={() => setDialog('watermark')} onPageNumbers={() => setDialog('pagenumbers')} />
      <div className="workspace">
        {panels.left && <Sidebar />}
        <ToolRail onSignature={() => setDialog('signature')} />
        <div className="desk-wrap">
          <ScanBanner />
          {findOpen && <FindBar />}
          <Viewer />
        </div>
        {panels.right && (rightPanel === 'comments' ? <CommentsPanel /> : <PropertiesPanel />)}
        {(panels.left || panels.right) && (
          // Phones: panels slide over the page; tapping outside closes them.
          <div
            className="drawer-scrim"
            onClick={() => {
              const st = useStore.getState();
              st.setPanelOpen('left', false);
              st.setPanelOpen('right', false);
            }}
          />
        )}
      </div>
      {drag && (
        <>
          {drag.pageId && <style>{`.page[data-page-id="${drag.pageId}"]{outline:3px solid var(--marker);outline-offset:4px}`}</style>}
          <div className="drop-overlay">
            <span className="drop-hint">{dropHint(drag)}</span>
          </div>
        </>
      )}
      {busy && (
        <div className="busy" role="alert" aria-busy="true">
          <div className="busy-card">
            <span className="spinner" aria-hidden />
            {busy}
          </div>
        </div>
      )}
      {overlays}
    </div>
  );
}
