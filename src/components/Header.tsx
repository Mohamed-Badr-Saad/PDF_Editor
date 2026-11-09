import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  MessagesSquare,
  Search,
  FilePlus,
  FilePlus2,
  FolderOpen,
  Hash,
  Maximize2,
  Redo2,
  ScanText,
  Scissors,
  Stamp,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useStore } from '../state/store';
import { ACCEPT_ALL, importFiles, pickFiles } from '../lib/importFiles';
import { insertBlankPage, saveDocument, splitAllPages } from '../lib/actions';
import { exportCommentsCsv } from '../lib/comments';
import { fitPageZoom, fitWidthZoom } from './Viewer';
import { Logo } from './Logo';

interface Props {
  onWatermark(): void;
  onPageNumbers(): void;
}

export function Header({ onWatermark, onPageNumbers }: Props) {
  const fileName = useStore((s) => s.fileName);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const zoom = useStore((s) => s.zoom);
  const pageCount = useStore((s) => s.present.pages.length);
  const dirty = useStore((s) => s.dirty);
  const activeIndex = useStore((s) => Math.max(0, s.present.pages.findIndex((p) => p.id === s.activePageId)));
  const [pageInput, setPageInput] = useState<string | null>(null);
  const rightPanel = useStore((s) => s.rightPanel);
  const commentCount = useStore((s) =>
    Object.values(s.present.annotations).reduce((n, list) => n + list.filter((a) => a.type === 'note' || a.type === 'markup').length, 0),
  );
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const st = useStore.getState;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const item = (icon: React.ReactNode, label: string, fn: () => void, hint?: string) => (
    <button
      role="menuitem"
      className="menu-item"
      onClick={() => {
        setMenu(false);
        fn();
      }}
    >
      {icon}
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );

  return (
    <header className="header">
      <div className="brand">
        <Logo />
      </div>
      <input
        className="file-name"
        value={fileName}
        aria-label="File name"
        spellCheck={false}
        onChange={(e) => st().setFileName(e.target.value)}
        onBlur={(e) => {
          const v = e.target.value.trim() || 'document';
          st().setFileName(/\.pdf$/i.test(v) ? v : `${v}.pdf`);
        }}
      />
      {dirty && (
        <span className="unsaved" data-tip="Unsaved changes. Click Save PDF to download the edited file." aria-label="Unsaved changes">
          Edited
        </span>
      )}
      <label className="page-nav" data-tip="Go to page">
        <span className="sr-only">Page</span>
        <input
          inputMode="numeric"
          aria-label="Page number"
          value={pageInput ?? String(activeIndex + 1)}
          onFocus={(e) => {
            setPageInput(String(activeIndex + 1));
            requestAnimationFrame(() => e.target.select());
          }}
          onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => setPageInput(null)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              const n = Math.min(pageCount, Math.max(1, parseInt(pageInput ?? '', 10) || 1));
              const p = st().present.pages[n - 1];
              if (p) st().scrollToPage(p.id);
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="page-total">/ {pageCount}</span>
      </label>

      <div className="menu-wrap" ref={menuRef}>
        <button className="hbtn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          Document <ChevronDown size={15} />
        </button>
        {menu && (
          <div className="menu" role="menu">
            {item(<FolderOpen size={16} />, 'Open another file…', async () => {
              const files = await pickFiles(ACCEPT_ALL, false);
              if (files.length && (!st().dirty || confirm('Discard your unsaved changes and open another file?'))) importFiles(files, { replace: true });
            }, 'Ctrl O')}
            {item(<FilePlus size={16} />, 'Add PDFs or images…', async () => {
              const files = await pickFiles(ACCEPT_ALL, true);
              if (files.length) importFiles(files);
            })}
            {item(<FilePlus2 size={16} />, 'Insert blank page', () => {
              const s = st();
              const i = s.present.pages.findIndex((p) => p.id === s.activePageId);
              insertBlankPage(i + 1, s.present.pages[i]);
            })}
            <div className="menu-sep" />
            {item(<ScanText size={16} />, 'Recognize text (OCR)…', () => st().openDialog('ocr'))}
            {item(<Stamp size={16} />, 'Add watermark…', onWatermark)}
            {item(<Hash size={16} />, 'Add page numbers…', onPageNumbers)}
            {item(<Scissors size={16} />, 'Split into single pages', splitAllPages)}
            {item(<FileSpreadsheet size={16} />, 'Export notes to CSV', exportCommentsCsv)}
            <div className="menu-sep" />
            {item(<X size={16} />, 'Close document', () => {
              if (!st().dirty || confirm('Close without saving your changes?')) st().reset();
            })}
          </div>
        )}
      </div>

      <span className="header-spacer" />

      <div className="hgroup" role="group" aria-label="Find and comments">
        <button
          className="hbtn icon"
          onClick={() => st().setFind(st().find ? null : { query: '', matches: [], current: 0, searching: false })}
          data-tip="Find" data-tip-key="Ctrl F"
          aria-label="Find"
        >
          <Search size={18} />
        </button>
        <button
          className={`hbtn ${rightPanel === 'comments' ? 'is-on' : ''}`}
          onClick={() => st().setRightPanel(rightPanel === 'comments' ? 'properties' : 'comments')}
          data-tip="All comments and notes"
          aria-pressed={rightPanel === 'comments'}
        >
          <MessagesSquare size={18} />
          <span className="hbtn-label">Comments{commentCount ? ` ${commentCount}` : ''}</span>
        </button>
      </div>

      <div className="hgroup" role="group" aria-label="History">
        <button className="hbtn icon" onClick={() => st().undo()} disabled={!canUndo} data-tip="Undo" data-tip-key="Ctrl Z" aria-label="Undo">
          <Undo2 size={18} />
        </button>
        <button className="hbtn icon" onClick={() => st().redo()} disabled={!canRedo} data-tip="Redo" data-tip-key="Ctrl Y" aria-label="Redo">
          <Redo2 size={18} />
        </button>
      </div>

      <div className="hgroup zoom" role="group" aria-label="Zoom">
        <button className="hbtn icon" onClick={() => st().setZoom(zoom / 1.2)} data-tip="Zoom out" data-tip-key="Ctrl −" aria-label="Zoom out">
          <ZoomOut size={18} />
        </button>
        <button className="hbtn zoom-val" onClick={() => st().setZoom(1)} data-tip="Actual size" data-tip-key="Ctrl 0">
          {Math.round(zoom * 100)}%
        </button>
        <button className="hbtn icon" onClick={() => st().setZoom(zoom * 1.2)} data-tip="Zoom in" data-tip-key="Ctrl +" aria-label="Zoom in">
          <ZoomIn size={18} />
        </button>
        <button
          className="hbtn icon"
          onClick={() => {
            const fw = fitWidthZoom();
            st().setZoom(Math.abs(fw - zoom) < 0.02 ? fitPageZoom() : fw);
          }}
          data-tip="Fit width / whole page"
          aria-label="Fit to window"
        >
          <Maximize2 size={17} />
        </button>
      </div>

      <button className="btn btn-save" onClick={saveDocument} data-tip="Download the edited PDF" data-tip-key="Ctrl S">
        <Download size={17} /> <span className="save-label">Save PDF</span>
      </button>
    </header>
  );
}
