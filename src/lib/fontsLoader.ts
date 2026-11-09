/** Loads the bundled Unicode font (Noto Sans Arabic) for embedding in saved PDFs. */
const cache = new Map<boolean, Promise<Uint8Array>>();
export function loadUnicodeFont(bold: boolean): Promise<Uint8Array> {
  let p = cache.get(bold);
  if (!p) {
    const url = new URL(`fonts/NotoSansArabic-${bold ? 'Bold' : 'Regular'}.ttf`, document.baseURI);
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error('The Arabic font could not be loaded.');
      return r.arrayBuffer().then((b) => new Uint8Array(b));
    });
    p.catch(() => cache.delete(bold));
    cache.set(bold, p);
  }
  return p;
}
