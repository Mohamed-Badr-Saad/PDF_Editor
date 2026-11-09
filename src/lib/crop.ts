// Cropping images: the draft box lives in the store while the user drags it.
import { useStore } from '../state/store';
import { fullImageBox } from './geometry';
import type { ImageAnn } from './types';

export function startCrop(pageId: string, annId: string) {
  const st = useStore.getState();
  const a = st.present.annotations[pageId]?.find((x) => x.id === annId);
  if (a?.type !== 'image') return;
  st.setTool('select');
  st.select({ pageId, annId });
  st.setCropping({ pageId, annId, draft: { x: a.x, y: a.y, w: a.w, h: a.h } });
}

export function applyCrop() {
  const st = useStore.getState();
  const c = st.cropping;
  if (!c) return;
  st.setCropping(null);
  const a = st.present.annotations[c.pageId]?.find((x) => x.id === c.annId) as ImageAnn | undefined;
  if (!a) return;
  const full = fullImageBox(a);
  const d = c.draft;
  if (Math.abs(d.x - a.x) < 0.01 && Math.abs(d.y - a.y) < 0.01 && Math.abs(d.w - a.w) < 0.01 && Math.abs(d.h - a.h) < 0.01) return;
  const crop = { x: (d.x - full.x) / full.w, y: (d.y - full.y) / full.h, w: d.w / full.w, h: d.h / full.h };
  const isFull = crop.x < 0.001 && crop.y < 0.001 && crop.w > 0.999 && crop.h > 0.999;
  st.updateAnnotation(c.pageId, c.annId, (x) => ({ ...(x as ImageAnn), ...d, crop: isFull ? undefined : crop }));
}

export function cancelCrop() {
  useStore.getState().setCropping(null);
}

/** Removes the crop, showing the whole picture again. */
export function resetCrop(pageId: string, annId: string) {
  const st = useStore.getState();
  st.setCropping(null);
  st.updateAnnotation(pageId, annId, (x) => {
    const a = x as ImageAnn;
    return { ...a, ...fullImageBox(a), crop: undefined };
  });
}
