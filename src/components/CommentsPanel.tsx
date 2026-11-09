import { useEffect, useState } from 'react';
import { FileSpreadsheet, MessageSquareText, X } from 'lucide-react';
import { useStore } from '../state/store';
import { collectComments, exportCommentsCsv, type CommentItem } from '../lib/comments';

/** Lists every comment in the document (added here or already in the file). */
export function CommentsPanel() {
  const annotations = useStore((s) => s.present.annotations);
  const pages = useStore((s) => s.present.pages);
  const ocr = useStore((s) => s.ocr);
  const author = useStore((s) => s.author);
  const selection = useStore((s) => s.selection);
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const st = useStore.getState;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => collectComments().then((r) => alive && setItems(r)), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [annotations, pages, ocr]);

  const open = (c: CommentItem) => {
    st().scrollToPage(c.pageId);
    st().setActivePage(c.pageId);
    if (c.annId) st().select({ pageId: c.pageId, annId: c.annId });
  };

  let lastPage = 0;
  return (
    <aside className="panel comments" aria-label="Comments">
      <section className="panel-section">
        <div className="panel-title-row">
          <h2 className="panel-title">Comments{items ? ` (${items.length})` : ''}</h2>
          <button className="icon-btn" aria-label="Close comments" onClick={() => st().setRightPanel('properties')}>
            <X size={15} />
          </button>
        </div>
        <label className="field">
          <span className="field-label">Your name on new comments</span>
          <input type="text" value={author} placeholder="e.g. Badr" onChange={(e) => st().setAuthor(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <button className="btn" onClick={exportCommentsCsv} disabled={!items?.length}>
          <FileSpreadsheet size={15} /> Export notes to CSV
        </button>
      </section>
      <section className="comment-list">
        {items === null && <p className="hint">Looking for comments…</p>}
        {items?.length === 0 && (
          <div className="empty">
            <MessageSquareText size={28} strokeWidth={1.5} />
            <p>No comments yet.</p>
            <p className="hint">Select text (U) to highlight it and add a note, or place a sticky note (N) anywhere.</p>
          </div>
        )}
        {items?.map((c) => {
          const header = c.pageNumber !== lastPage ? <h3 className="comment-page">Page {c.pageNumber}</h3> : null;
          lastPage = c.pageNumber;
          return (
            <div key={c.key}>
              {header}
              <button className={`comment ${selection?.annId && selection.annId === c.annId ? 'is-selected' : ''}`} onClick={() => open(c)}>
                <span className="comment-head">
                  <span className="comment-dot" style={{ background: c.color ?? '#999' }} aria-hidden />
                  <span className="comment-type">{c.type}</span>
                  {c.origin === 'file' && <span className="badge">In file</span>}
                </span>
                {c.quoted && (
                  <span className="comment-quote" dir="auto">
                    {c.quoted}
                  </span>
                )}
                {c.note ? (
                  <span className="comment-note" dir="auto">
                    {c.note}
                  </span>
                ) : (
                  c.origin === 'editor' && <span className="comment-empty">No note</span>
                )}
                <span className="comment-meta">
                  {c.author || (c.origin === 'editor' ? 'You' : 'Unknown')}
                  {c.date ? `, ${new Date(c.date).toLocaleDateString()}` : ''}
                </span>
              </button>
            </div>
          );
        })}
      </section>
    </aside>
  );
}
