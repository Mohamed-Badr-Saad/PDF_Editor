import { memo, useEffect, useRef, useState } from 'react';
import { Copy, FilePlus2, RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { useStore } from '../state/store';
import type { Annotation, PageItem } from '../lib/types';
import { displaySize } from '../lib/geometry';
import { renderPage } from '../lib/pdf';
import { useRenderSource } from '../lib/content/editorBridge';
import { AnnotationShapes } from './AnnotationShapes';
import { insertBlankPage } from '../lib/actions';
import { importFiles } from '../lib/importFiles';

const EMPTY: Annotation[] = [];
const THUMB_W = 116;
const THUMB_H = 150;

const Thumb = memo(function Thumb({ page }: { page: PageItem }) {
  const annotations = useStore((s) => s.present.annotations[page.id] ?? EMPTY);
  const images = useStore((s) => s.images);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const d = displaySize(page);
  const scale = Math.min(THUMB_W / d.width, THUMB_H / d.height);
  const src = useRenderSource(page);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near || !src || !canvasRef.current) return;
    const h = renderPage(src.docId, src.index, 0, scale, canvasRef.current);
    h.promise.catch(() => {});
    return () => h.cancel();
  }, [near, src, scale]);

  const bw = page.width * scale;
  const bh = page.height * scale;
  return (
    <div ref={boxRef} className="thumb-paper" style={{ width: d.width * scale, height: d.height * scale }}>
      <div
        className="page-layer"
        style={{
          width: bw,
          height: bh,
          left: (d.width * scale - bw) / 2,
          top: (d.height * scale - bh) / 2,
          transform: `rotate(${page.rotation}deg)`,
        }}
      >
        {page.docId && <canvas ref={canvasRef} className="page-canvas" style={{ width: bw, height: bh }} />}
        <svg className="page-svg" viewBox={`0 0 ${page.width} ${page.height}`} width={bw} height={bh}>
          <AnnotationShapes annotations={annotations} images={images} scale={scale} />
        </svg>
      </div>
    </div>
  );
});

export function Sidebar() {
  const pages = useStore((s) => s.present.pages);
  const selected = useStore((s) => s.selectedPages);
  const activeId = useStore((s) => s.activePageId);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const anchor = useRef<string | null>(null);
  const selectedSet = new Set(selected);

  const onClick = (e: React.MouseEvent, p: PageItem) => {
    const st = useStore.getState();
    if (e.shiftKey && anchor.current) {
      const a = pages.findIndex((x) => x.id === anchor.current);
      const b = pages.findIndex((x) => x.id === p.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      st.setSelectedPages(pages.slice(lo, hi + 1).map((x) => x.id));
    } else if (e.ctrlKey || e.metaKey) {
      st.setSelectedPages(selectedSet.has(p.id) ? selected.filter((id) => id !== p.id) : [...selected, p.id]);
      anchor.current = p.id;
    } else {
      st.setSelectedPages([p.id]);
      anchor.current = p.id;
    }
    st.scrollToPage(p.id);
  };

  const indexFromEvent = (e: React.DragEvent, i: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? i : i + 1;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const at = dropIndex ?? pages.length;
    setDropIndex(null);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      importFiles(files, { at });
      return;
    }
    const ids = e.dataTransfer.getData('application/x-pagecraft-pages');
    if (ids) useStore.getState().movePages(JSON.parse(ids), at);
  };

  return (
    <aside className="sidebar" aria-label="Pages">
      <div
        className="thumbs"
        onDragOver={(e) => {
          e.preventDefault();
          if ((e.target as HTMLElement) === e.currentTarget) setDropIndex(pages.length);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
        }}
        onDrop={onDrop}
      >
        {pages.map((p, i) => (
          <div
            key={p.id}
            className={`thumb ${selectedSet.has(p.id) ? 'is-selected' : ''} ${activeId === p.id ? 'is-active' : ''} ${
              dropIndex === i ? 'drop-before' : ''
            } ${dropIndex === i + 1 && i === pages.length - 1 ? 'drop-after' : ''}`}
            draggable
            onDragStart={(e) => {
              const ids = selectedSet.has(p.id) ? pages.filter((x) => selectedSet.has(x.id)).map((x) => x.id) : [p.id];
              e.dataTransfer.setData('application/x-pagecraft-pages', JSON.stringify(ids));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropIndex(indexFromEvent(e, i));
            }}
            onDragEnd={() => setDropIndex(null)}
            onClick={(e) => onClick(e, p)}
          >
            <Thumb page={p} />
            <div className="thumb-label">{i + 1}</div>
            <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
              <button title="Rotate left" aria-label="Rotate left" onClick={() => useStore.getState().rotatePages([p.id], -90)}>
                <RotateCcw size={14} />
              </button>
              <button title="Rotate right" aria-label="Rotate right" onClick={() => useStore.getState().rotatePages([p.id], 90)}>
                <RotateCw size={14} />
              </button>
              <button title="Duplicate page" aria-label="Duplicate page" onClick={() => useStore.getState().duplicatePages([p.id])}>
                <Copy size={14} />
              </button>
              <button title="Insert blank page after" aria-label="Insert blank page after" onClick={() => insertBlankPage(i + 1, p)}>
                <FilePlus2 size={14} />
              </button>
              <button
                title="Delete page"
                aria-label="Delete page"
                className="danger"
                disabled={pages.length === 1}
                onClick={() => useStore.getState().deletePages([p.id])}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
