import { createRoot } from 'react-dom/client';
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/700.css';
import './styles.css';
import App from './App';
import { importFiles } from './lib/importFiles';
import { useStore } from './state/store';
import { registerSW } from 'virtual:pwa-register';
import { initInstall, isDesktopApp } from './lib/install';

// Cache the app for offline use and update silently when a new version is deployed.
// The desktop app ships its files with it, so it needs no service worker.
if (!isDesktopApp()) registerSW({ immediate: true });
initInstall();

// Arabic/Unicode web font: the same file is embedded when saving, so text looks identical.
const fontBase = new URL('fonts/', document.baseURI).href;
const faces = [
  new FontFace('PageCraft Arabic', `url(${fontBase}NotoSansArabic-Regular.ttf)`, { weight: '400' }),
  new FontFace('PageCraft Arabic', `url(${fontBase}NotoSansArabic-Bold.ttf)`, { weight: '700' }),
];
faces.forEach((f) => document.fonts.add(f));
const loadFonts = () =>
  Promise.all(faces.map((f) => f.load()))
    .then(() => useStore.setState({ fontsReady: true })) // re-measure text drawn with it
    .catch(() => {});
('requestIdleCallback' in window ? window.requestIdleCallback : setTimeout)(loadFonts as () => void);

createRoot(document.getElementById('root')!).render(<App />);

// Desktop app: PDFs opened from Explorer/Finder ("Open with PageCraft").
window.pagecraftDesktop?.onOpenFiles((files) => {
  const st = useStore.getState();
  if (st.present.pages.length && st.dirty && !confirm(`Discard your unsaved changes and open ${files[0].name}?`)) return;
  const type = (n: string) => (/\.pdf$/i.test(n) ? 'application/pdf' : /\.png$/i.test(n) ? 'image/png' : 'image/jpeg');
  importFiles(
    files.map((f) => new File([f.data as BlobPart], f.name, { type: type(f.name) })),
    { replace: true },
  );
});
