import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { PageView } from './PageView';
import { displaySize } from '../lib/geometry';

/** Scrollable desk with all pages stacked vertically. */
export function Viewer() {
  const pages = useStore((s) => s.present.pages);
  const zoom = useStore((s) => s.zoom);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const ref = useRef<HTMLDivElement>(null);

  // On open, shrink to fit if the pages are wider than the window (phones, small laptops).
  useEffect(() => {
    useStore.getState().setZoom(Math.min(1, fitWidthZoom()));
  }, []);

  // Track which page is most visible.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set((e.target as HTMLElement).dataset.pageId!, e.intersectionRatio);
        let best: string | null = null;
        let bestR = 0;
        ratios.forEach((r, id) => {
          if (r > bestR) {
            bestR = r;
            best = id;
          }
        });
        if (best) useStore.getState().setActivePage(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll('.page').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages]);

  useEffect(() => {
    if (!scrollRequest) return;
    const el = ref.current?.querySelector<HTMLElement>(`[data-page-id="${scrollRequest.pageId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [scrollRequest]);

  // Ctrl/⌘ + wheel zooms around the pointer.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const st = useStore.getState();
      const old = st.zoom;
      const next = Math.min(4, Math.max(0.25, old * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left + el.scrollLeft;
      const py = e.clientY - rect.top + el.scrollTop;
      st.setZoom(next);
      requestAnimationFrame(() => {
        const k = useStore.getState().zoom / old;
        el.scrollLeft = px * k - (e.clientX - rect.left);
        el.scrollTop = py * k - (e.clientY - rect.top);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div ref={ref} className="desk" id="desk">
      <div className="desk-inner" style={{ ['--zoom' as string]: zoom }}>
        {pages.map((p, i) => (
          <div key={p.id} className="page-slot">
            <PageView page={p} index={i} />
            <div className="page-number">
              {i + 1} / {pages.length}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Zoom level that fits the widest page into the desk. */
export function fitWidthZoom(): number {
  const desk = document.getElementById('desk');
  const pages = useStore.getState().present.pages;
  if (!desk || !pages.length) return 1;
  const maxW = Math.max(...pages.map((p) => displaySize(p).width));
  const pad = desk.clientWidth < 600 ? 24 : 64;
  return Math.max(0.25, Math.min(4, (desk.clientWidth - pad) / maxW));
}

export function fitPageZoom(): number {
  const desk = document.getElementById('desk');
  const st = useStore.getState();
  const page = st.present.pages.find((p) => p.id === st.activePageId) ?? st.present.pages[0];
  if (!desk || !page) return 1;
  const d = displaySize(page);
  return Math.max(0.25, Math.min(4, Math.min((desk.clientWidth - 64) / d.width, (desk.clientHeight - 64) / d.height)));
}
