// Finds pages that are scans or photos (a picture with no real text), so OCR
// can be offered as soon as a document opens.
import { useStore, ocrKey } from '../state/store';
import { getAnalysis } from './content/editorBridge';
import type { PageItem } from './types';

const known = new Map<string, Promise<boolean>>();

function coversPage(boxes: { w: number; h: number }[], page: PageItem) {
  return boxes.some((b) => b.w * b.h >= page.width * page.height * 0.5);
}

function isScan(page: PageItem): Promise<boolean> {
  if (!page.docId) {
    // Photo turned into a page.
    const anns = useStore.getState().present.annotations[page.id] ?? [];
    return Promise.resolve(coversPage(anns.filter((a) => a.type === 'image') as { w: number; h: number }[], page));
  }
  const key = ocrKey(page);
  let p = known.get(key);
  if (!p) {
    p = getAnalysis(page).then((a) => !!a && a.segments.length <= 2 && coversPage(a.images.map((i) => i.box), page));
    known.set(key, p);
  }
  return p;
}

let run = 0;
/** Re-checks all pages (cheap: results are cached per source page). */
export async function detectScans() {
  const id = ++run;
  const pages = useStore.getState().present.pages;
  const found: string[] = [];
  for (const p of pages) {
    if (await isScan(p)) found.push(p.id);
    if (id !== run) return;
  }
  useStore.setState({ scanPages: found });
}

/** "3–4, 7" from page numbers. */
export function formatPageList(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Scanned pages that haven't been recognised yet. */
export function usePendingScans(): PageItem[] {
  const scanPages = useStore((s) => s.scanPages);
  const pages = useStore((s) => s.present.pages);
  const ocr = useStore((s) => s.ocr);
  const set = new Set(scanPages);
  return pages.filter((p) => set.has(p.id) && !ocr[ocrKey(p)]);
}
