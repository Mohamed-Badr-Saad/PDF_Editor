// Drag and drop onto the editor: images land on the page where they're
// dropped; PDFs (and images dropped beside the pages) become new pages.
import { useStore, uid } from '../state/store';
import { displayToBase } from './geometry';
import { importFiles, loadImage, rotatedImage } from './importFiles';
import type { ImageAnn } from './types';

export interface DragInfo {
  pageId: string | null;
  pageNumber: number;
  images: number;
  pdfs: number;
}

const isImageType = (t: string) => t.startsWith('image/');
const isPdfType = (t: string) => t === 'application/pdf';

/** What is being dragged, and over which page (works during dragover, before files are readable). */
export function describeDrag(e: DragEvent | React.DragEvent): DragInfo | null {
  const items = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file');
  if (!items.length && !e.dataTransfer?.types.includes('Files')) return null;
  const pageEl = (e.target as Element | null)?.closest?.('.page') as HTMLElement | null;
  const pageId = pageEl?.dataset.pageId ?? null;
  const pages = useStore.getState().present.pages;
  return {
    pageId,
    pageNumber: pageId ? pages.findIndex((p) => p.id === pageId) + 1 : 0,
    images: items.filter((i) => isImageType(i.type)).length,
    // Some systems don't report the type while dragging; count unknown files as documents.
    pdfs: items.filter((i) => isPdfType(i.type) || !i.type).length,
  };
}

/** Message shown while dragging. */
export function dropHint(d: DragInfo): string {
  const onPage = d.pageId && d.images > 0;
  if (onPage && d.pdfs) return `Images go onto page ${d.pageNumber}; PDFs are added as new pages after it.`;
  if (onPage) return d.images === 1 ? `Drop to place the image on page ${d.pageNumber}` : `Drop to place ${d.images} images on page ${d.pageNumber}`;
  if (d.pdfs && d.pageId) return `Drop to add the PDF pages after page ${d.pageNumber}`;
  if (d.pdfs && !d.images) return 'Drop to add the PDF pages at the end of the document';
  return 'Drop to add these files as new pages at the end. Drop images onto a page to place them there.';
}

/** Handles a drop anywhere in the editor. */
export async function handleDrop(e: React.DragEvent) {
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;
  const st = useStore.getState();
  const pageEl = (e.target as Element).closest('.page') as HTMLElement | null;
  const page = pageEl ? st.present.pages.find((p) => p.id === pageEl.dataset.pageId) : undefined;
  const images = page ? files.filter((f) => isImageType(f.type)) : [];
  const rest = files.filter((f) => !images.includes(f));

  if (page && pageEl && images.length) {
    const r = pageEl.getBoundingClientRect();
    const zoom = st.zoom;
    const [cx, cy] = displayToBase((e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom, page);
    let last: ImageAnn | null = null;
    for (const [i, f] of images.entries()) {
      try {
        const img = await rotatedImage(await loadImage(f), page.rotation);
        // Fit within half the page, centered on the drop point (later images cascade).
        const scale = Math.min(1, (page.width * 0.5) / img.width, (page.height * 0.5) / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = Math.min(Math.max(0, cx - w / 2 + i * 16), page.width - w);
        const y = Math.min(Math.max(0, cy - h / 2 + i * 16), page.height - h);
        last = { id: uid('ann'), type: 'image', x, y, w, h, imageId: img.id, opacity: 1 };
        st.addAnnotation(page.id, last);
      } catch {
        st.toast(`Couldn't read "${f.name}" as an image.`, 'error');
      }
    }
    if (last) {
      st.setTool('select');
      st.select({ pageId: page.id, annId: last.id });
      st.toast(images.length === 1 ? 'Image placed. Drag it or its corners to adjust.' : `${images.length} images placed.`);
    }
  }
  if (rest.length) {
    const at = page ? st.present.pages.indexOf(page) + 1 : undefined;
    await importFiles(rest, { at });
  }
}
