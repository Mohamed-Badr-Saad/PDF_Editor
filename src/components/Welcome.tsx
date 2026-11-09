import { useState } from 'react';
import { FilePlus2, Upload } from 'lucide-react';
import { ACCEPT_ALL, importFiles, pickFiles } from '../lib/importFiles';
import { insertBlankPage } from '../lib/actions';
import { useStore } from '../state/store';
import { Logo } from './Logo';

const FEATURES: [string, string][] = [
  ['Fill and sign', 'Type on any page, draw or upload your signature, and place it anywhere.'],
  ['Mark up', 'Highlight, draw, add shapes and arrows, or white-out a mistake and retype it.'],
  ['Organize pages', 'Merge files, reorder by dragging, rotate, duplicate, delete or extract pages.'],
  ['Turn images into PDFs', 'Drop photos or scans and save them as a single PDF.'],
];

export function Welcome() {
  const [over, setOver] = useState(false);
  const busy = useStore((s) => s.busy);

  return (
    <div className="welcome">
      <header className="welcome-head">
        <Logo />
      </header>
      <main className="welcome-main">
        <div className="welcome-copy">
          <h1>Edit PDFs right in your browser.</h1>
          <p className="lede">
            Free, no account, no upload. Your files are processed on this device and never sent anywhere. Once loaded, it even
            works offline.
          </p>
        </div>
        <ul className="features">
            {FEATURES.map(([t, d]) => (
              <li key={t}>
                <strong>{t}</strong>
                <span>{d}</span>
              </li>
            ))}
        </ul>

        <div
          className={`drop-sheet ${over ? 'is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            importFiles(Array.from(e.dataTransfer.files), { replace: true });
          }}
        >
          <div className="drop-fold" aria-hidden />
          <div className="drop-content">
            <Upload size={34} strokeWidth={1.6} />
            <p className="drop-title">{busy ?? 'Drop a PDF or images here'}</p>
            <button
              className="btn btn-primary btn-lg"
              disabled={!!busy}
              onClick={async () => {
                const files = await pickFiles(ACCEPT_ALL, true);
                if (files.length) importFiles(files, { replace: true });
              }}
            >
              Choose files
            </button>
            <button className="btn btn-quiet" onClick={() => insertBlankPage(0)} disabled={!!busy}>
              <FilePlus2 size={16} /> Start with a blank page
            </button>
          </div>
        </div>
      </main>
      <footer className="welcome-foot">PageCraft is free. Install it from your browser's address bar to use it like a desktop app.</footer>
    </div>
  );
}
