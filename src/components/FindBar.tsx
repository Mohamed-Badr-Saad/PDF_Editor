import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useStore, type FindMatch } from '../state/store';
import { findInLayout, getTextLayout } from '../lib/textLayout';

/** Ctrl+F: finds words in the PDF's text and in recognized (OCR) text. */
export function FindBar() {
  const find = useStore((s) => s.find);
  const [query, setQuery] = useState(find?.query ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const st = useStore.getState;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const id = ++run.current;
    const q = query.trim();
    if (!q) {
      st().setFind({ query, matches: [], current: 0, searching: false });
      return;
    }
    const t = setTimeout(async () => {
      st().setFind({ query, matches: st().find?.matches ?? [], current: 0, searching: true });
      const matches: FindMatch[] = [];
      for (const page of st().present.pages) {
        const layout = await getTextLayout(page);
        if (id !== run.current) return;
        for (const boxes of findInLayout(layout, q)) matches.push({ pageId: page.id, boxes });
      }
      if (id !== run.current) return;
      st().setFind({ query, matches, current: 0, searching: false });
      if (matches.length) st().scrollToPage(matches[0].pageId);
    }, 220);
    return () => clearTimeout(t);
  }, [query, st]);

  const go = (delta: number) => {
    const f = st().find;
    if (!f?.matches.length) return;
    const current = (f.current + delta + f.matches.length) % f.matches.length;
    st().setFind({ ...f, current });
    st().scrollToPage(f.matches[current].pageId);
  };

  const close = () => st().setFind(null);
  const n = find?.matches.length ?? 0;

  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        type="search"
        placeholder="Find in document"
        value={query}
        aria-label="Find in document"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') go(e.shiftKey ? -1 : 1);
          if (e.key === 'Escape') close();
        }}
      />
      <span className="find-count" aria-live="polite">
        {find?.searching ? 'Searching…' : query.trim() ? (n ? `${(find?.current ?? 0) + 1} of ${n}` : 'No matches') : ''}
      </span>
      <button className="icon-btn" aria-label="Previous match" onClick={() => go(-1)} disabled={!n}>
        <ChevronUp size={16} />
      </button>
      <button className="icon-btn" aria-label="Next match" onClick={() => go(1)} disabled={!n}>
        <ChevronDown size={16} />
      </button>
      <button className="icon-btn" aria-label="Close search" onClick={close}>
        <X size={16} />
      </button>
    </div>
  );
}
