import { useEffect, useRef, useState } from 'react';
import { ClipboardCopy, Download } from 'lucide-react';
import { Modal } from './Modal';
import { useStore } from '../state/store';
import { OCR_LANGS, ocrPlainText, runOcr, type OcrLang, type OcrProgress, type OcrRun } from '../lib/ocr/recognize';
import { getAnalysis } from '../lib/content/editorBridge';
import type { PageItem } from '../lib/types';

const LANG_KEY = 'pagecraft.ocrLang';

type Scope = 'all' | 'current' | 'selected';

export function OcrDialog({ onClose }: { onClose(): void }) {
  const pages = useStore((s) => s.present.pages);
  const selected = useStore((s) => s.selectedPages);
  const activeId = useStore((s) => s.activePageId);
  const [lang, setLang] = useState<OcrLang>(() => {
    try {
      return (localStorage.getItem(LANG_KEY) as OcrLang) || 'eng';
    } catch {
      return 'eng';
    }
  });
  const [scope, setScope] = useState<Scope>(selected.length > 1 ? 'selected' : pages.length > 1 ? 'all' : 'current');
  const [skipText, setSkipText] = useState(true);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [done, setDone] = useState<{ pages: PageItem[]; lines: number; skipped: number } | null>(null);
  const run = useRef<OcrRun | null>(null);

  useEffect(() => () => run.current?.cancel(), []);

  const start = async () => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* not remembered */
    }
    let target =
      scope === 'all'
        ? pages
        : scope === 'selected'
          ? pages.filter((p) => selected.includes(p.id))
          : pages.filter((p) => p.id === (activeId ?? pages[0]?.id));
    let skipped = 0;
    if (skipText) {
      setProgress({ pageIndex: 0, pageCount: target.length, progress: 0, status: 'Checking which pages are scans…' });
      const keep: PageItem[] = [];
      for (const p of target) {
        const a = await getAnalysis(p);
        // A page with real text doesn't need OCR.
        if (a && a.segments.length > 3) skipped++;
        else keep.push(p);
      }
      target = keep;
    }
    if (!target.length) {
      setProgress(null);
      setDone({ pages: [], lines: 0, skipped });
      return;
    }
    run.current = runOcr(target, lang, setProgress);
    try {
      const r = await run.current.promise;
      setDone({ pages: target, lines: r.lines, skipped });
    } catch (err) {
      console.error(err);
      if (run.current) useStore.getState().toast(`Text recognition failed: ${err instanceof Error ? err.message : err}`, 'error');
      onClose();
    } finally {
      setProgress(null);
      run.current = null;
    }
  };

  const cancel = () => {
    const r = run.current;
    run.current = null;
    r?.cancel();
    onClose();
  };

  if (done) {
    const text = done.pages.length ? ocrPlainText(done.pages) : '';
    return (
      <Modal
        title="Text recognized"
        onClose={onClose}
        footer={
          <>
            {text && (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(text).then(
                      () => useStore.getState().toast('Text copied.'),
                      () => useStore.getState().toast("Couldn't copy. Use Save as .txt instead.", 'error'),
                    );
                  }}
                >
                  <ClipboardCopy size={15} /> Copy text
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
                    a.download = useStore.getState().fileName.replace(/\.pdf$/i, '') + '.txt';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                  }}
                >
                  <Download size={15} /> Save as .txt
                </button>
              </>
            )}
            <span className="spacer" />
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </>
        }
      >
        {done.lines > 0 ? (
          <>
            <p className="dialog-text">
              Found {done.lines} line{done.lines === 1 ? '' : 's'} of text on {done.pages.length} page{done.pages.length === 1 ? '' : 's'}.
              {done.skipped > 0 && ` ${done.skipped} page${done.skipped === 1 ? '' : 's'} already had text and ${done.skipped === 1 ? 'was' : 'were'} skipped.`}
            </p>
            <ul className="dialog-list">
              <li>The saved PDF will be searchable, and its text can be selected and copied in any PDF reader.</li>
              <li>To change the text, use the Edit tool (E) and click a line.</li>
            </ul>
            <pre className="ocr-preview" dir="auto">{text.slice(0, 4000)}</pre>
          </>
        ) : (
          <p className="dialog-text">
            {done.skipped > 0 && !done.pages.length
              ? 'These pages already contain real text, so there was nothing to recognize. You can edit it directly with the Edit tool (E).'
              : 'No text was found. Check the language setting, or try a sharper scan.'}
          </p>
        )}
      </Modal>
    );
  }

  if (progress) {
    const overall = (progress.pageIndex + progress.progress) / Math.max(1, progress.pageCount);
    return (
      <Modal title="Recognizing text" onClose={cancel} footer={<><span className="spacer" /><button className="btn" onClick={cancel}>Cancel</button></>}>
        <p className="dialog-text">
          {progress.status} Page {Math.min(progress.pageIndex + 1, progress.pageCount)} of {progress.pageCount}
        </p>
        <div className="progress" role="progressbar" aria-valuenow={Math.round(overall * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-bar" style={{ width: `${Math.max(2, overall * 100)}%` }} />
        </div>
        <p className="hint">Everything runs on this device. The first run downloads the reading engine (about 8 MB), after that it works offline.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Recognize text (OCR)"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={start}>
            Recognize text
          </button>
        </>
      }
    >
      <p className="dialog-text">Turns scanned pages and photos into text you can search, copy and edit.</p>
      <label className="field">
        <span className="field-label">Language of the document</span>
        <select value={lang} onChange={(e) => setLang(e.target.value as OcrLang)}>
          {OCR_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span className="field-label">Pages</span>
        <div className="radio-row">
          <label className="check">
            <input type="radio" name="ocr-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All ({pages.length})
          </label>
          <label className="check">
            <input type="radio" name="ocr-scope" checked={scope === 'current'} onChange={() => setScope('current')} /> Current page
          </label>
          {selected.length > 0 && (
            <label className="check">
              <input type="radio" name="ocr-scope" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Selected ({selected.length})
            </label>
          )}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={skipText} onChange={(e) => setSkipText(e.target.checked)} />
        Skip pages that already contain text
      </label>
    </Modal>
  );
}
