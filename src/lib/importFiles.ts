import { useStore, uid } from '../state/store';
import { getPageSizes, openPdf, PasswordRequiredError } from './pdf';
import type { PageItem, StoredImage } from './types';

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);

/** Reads the EXIF orientation tag of a JPEG (1 = normal). */
function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > view.byteLength) break;
        if (view.getUint16(e, little) === 0x0112) return view.getUint16(e + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) break;
    offset += 2 + size;
  }
  return 1;
}

/** Converts any browser-decodable image to PNG/JPEG bytes suitable for pdf-lib. */
export async function loadImage(file: Blob): Promise<StoredImage> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  let bytes = raw;
  let mime: StoredImage['mime'];
  const type = file.type;
  if (type === 'image/png') {
    mime = 'image/png';
  } else if (type === 'image/jpeg' && jpegOrientation(raw) === 1) {
    mime = 'image/jpeg';
  } else {
    // Re-encode (also bakes in EXIF rotation, which PDFs ignore).
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const outType = type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('Image encoding failed'))), outType, 0.92),
    );
    bytes = new Uint8Array(await blob.arrayBuffer());
    mime = outType;
  }
  bitmap.close();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const img: StoredImage = { id: uid('img'), bytes, mime, url, width, height };
  useStore.getState().addImage(img);
  return img;
}

const rotatedCache = new Map<string, Promise<StoredImage>>();

/** Returns a copy of `img` rotated counter-clockwise by `deg` (cached). */
export function rotatedImage(img: StoredImage, deg: number): Promise<StoredImage> {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return Promise.resolve(img);
  const key = `${img.id}:${r}`;
  let p = rotatedCache.get(key);
  if (!p) {
    p = (async () => {
      const bitmap = await createImageBitmap(new Blob([img.bytes as BlobPart], { type: img.mime }));
      const swap = r % 180 !== 0;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((-r * Math.PI) / 180);
      ctx.drawImage(bitmap, -img.width / 2, -img.height / 2);
      bitmap.close();
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('rotate failed'))), 'image/png'));
      return loadImage(new File([blob], 'rotated.png', { type: 'image/png' }));
    })();
    rotatedCache.set(key, p);
  }
  return p;
}

async function openWithPassword(id: string, bytes: Uint8Array, name: string) {
  let password: string | undefined;
  for (;;) {
    try {
      return await openPdf(id, bytes, password);
    } catch (err) {
      if (!(err instanceof PasswordRequiredError)) throw err;
      const answer = window.prompt(
        err.incorrect ? `Wrong password for "${name}". Try again:` : `"${name}" is password protected. Enter its password:`,
      );
      if (answer === null) throw new Error(`"${name}" was not opened (password needed).`);
      password = answer;
    }
  }
}

async function pagesFromPdf(file: File): Promise<PageItem[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = uid('doc');
  const pdf = await openWithPassword(id, bytes, file.name);
  useStore.getState().addDoc({ id, name: file.name, bytes });
  const sizes = await getPageSizes(pdf);
  return sizes.map((s, i) => ({ id: uid('page'), docId: id, srcIndex: i, width: s.width, height: s.height, rotation: 0 }));
}

async function pageFromImage(file: File): Promise<PageItem> {
  const img = await loadImage(file);
  // Fit the image's longest side to 842pt (A4 height) at most.
  const scale = Math.min(1, 842 / Math.max(img.width, img.height)) || 1;
  const width = Math.round(img.width * scale * 100) / 100;
  const height = Math.round(img.height * scale * 100) / 100;
  const page: PageItem = { id: uid('page'), docId: null, srcIndex: 0, width, height, rotation: 0 };
  const store = useStore.getState();
  store.live((s) => ({
    ...s,
    annotations: {
      ...s.annotations,
      [page.id]: [{ id: uid('ann'), type: 'image', x: 0, y: 0, w: width, h: height, imageId: img.id, opacity: 1 }],
    },
  }));
  return page;
}

/**
 * Imports PDFs and images. With `replace`, starts a fresh document;
 * otherwise inserts the pages at `at` (default: end).
 */
export async function importFiles(files: File[], opts: { replace?: boolean; at?: number } = {}) {
  const store = useStore.getState();
  const usable = files.filter((f) => isPdf(f) || isImage(f));
  if (!usable.length) {
    store.toast('Choose a PDF or an image file (PNG, JPG, WebP).', 'error');
    return;
  }
  store.setBusy(usable.length > 1 ? `Opening ${usable.length} files…` : `Opening ${usable[0].name}…`);
  try {
    if (opts.replace) store.reset();
    const pages: PageItem[] = [];
    for (const f of usable) {
      try {
        if (isPdf(f)) pages.push(...(await pagesFromPdf(f)));
        else pages.push(await pageFromImage(f));
      } catch (err) {
        console.error(err);
        store.toast(err instanceof Error && err.message.includes('"') ? err.message : `Couldn't open "${f.name}". The file may be damaged.`, 'error');
      }
    }
    if (!pages.length) return;
    const s = useStore.getState();
    if (opts.replace || s.present.pages.length === 0) {
      const first = usable[0].name.replace(/\.[^.]+$/, '');
      s.setFileName(`${first}.pdf`);
    }
    s.insertPages(pages, opts.at);
    if (opts.replace) {
      // A freshly opened file starts with a clean history.
      useStore.setState({ past: [], future: [], dirty: false });
    } else {
      s.toast(`Added ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
      s.scrollToPage(pages[0].id);
    }
  } finally {
    useStore.getState().setBusy(null);
  }
}

export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export const ACCEPT_ALL = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp';
export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
