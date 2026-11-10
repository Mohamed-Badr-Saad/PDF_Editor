import { useState } from 'react';
import { Download, FilePlus2, Upload } from 'lucide-react';
import { ACCEPT_ALL, importFiles, pickFiles } from '../lib/importFiles';
import { insertBlankPage } from '../lib/actions';
import { useStore } from '../state/store';
import { Logo } from './Logo';
import { Credit } from './Credit';
import { installApp, isDesktopApp, useInstall } from '../lib/install';

// Phones and tablets can't drag files in, so the copy talks about picking them.
const touch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

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
        <Credit className="head-credit" />
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
            <p className="drop-title">{busy ?? (touch ? 'Open a PDF or images' : 'Drop a PDF or images here')}</p>
            {!busy && <p className="drop-sub">{touch ? 'Pick' : 'Drop'} several files to combine them into one PDF.</p>}
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
      <InstallFooter />
    </div>
  );
}

function InstallFooter() {
  const install = useInstall();
  if (isDesktopApp()) return <footer className="welcome-foot">PageCraft is free and works fully offline.</footer>;
  return (
    <footer className="welcome-foot">
      {install === 'prompt' ? (
        <>
          <button className="btn install-btn" onClick={() => installApp()}>
            <Download size={16} /> Install PageCraft
          </button>
          <span>Opens like an app and works offline.</span>
        </>
      ) : install === 'ios' ? (
        <span>To install on iPhone or iPad, tap Share, then Add to Home Screen. It then works offline.</span>
      ) : (
        <span>PageCraft is free and works offline once loaded.</span>
      )}
    </footer>
  );
}
