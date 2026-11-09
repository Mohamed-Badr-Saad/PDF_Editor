import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Bold, Copy, Crop, FileImage, FileOutput, Highlighter, ImageUp, Italic, RotateCcw, RotateCw, ScanText, Strikethrough, Trash2, Underline, X } from 'lucide-react';
import { useStore, uid, ocrKey } from '../state/store';
import { getAnalysis } from '../lib/content/editorBridge';
import type { Annotation, FontFamily, MarkupAnn, MarkupKind, NoteAnn, Tool } from '../lib/types';
import { applyCrop, cancelCrop, resetCrop, startCrop } from '../lib/crop';
import { moveAnn, usesOriginalFont } from '../lib/geometry';
import { ACCEPT_IMAGES, loadImage, pickFiles } from '../lib/importFiles';
import { exportPagesAsImages, extractPages } from '../lib/actions';

const INK = ['#1B2A41', '#000000', '#C2362B', '#2F5BEA', '#1E8A4C', '#E8771E', '#7B3FC4'];
const MARKERS = ['#FFE45C', '#9BF07A', '#7FD3FF', '#FF9ECF', '#FFB86B'];

const TOOL_NAMES: Record<Tool, string> = {
  select: 'Select',
  text: 'Text',
  draw: 'Pen',
  highlighter: 'Highlighter pen',
  highlight: 'Highlight area',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  whiteout: 'Cover (white-out)',
  image: 'Image',
  signature: 'Signature',
  edit: 'Edit text & images',
  note: 'Sticky note',
};

const ANN_NAMES: Record<Annotation['type'], string> = {
  text: 'Text',
  ink: 'Drawing',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  highlight: 'Highlight',
  whiteout: 'White-out',
  line: 'Line',
  arrow: 'Arrow',
  image: 'Image',
  note: 'Sticky note',
  markup: 'Marked text',
};

const TOOL_HINTS: Partial<Record<Tool, string>> = {
  select: 'Drag across text to highlight, comment on or copy it. Click an item you added to move, resize or edit it.',
  text: 'Click anywhere on a page to start typing.',
  draw: 'Drag on the page to draw. Great for quick marks and handwritten notes.',
  highlighter: 'Drag over text to mark it like a highlighter pen.',
  highlight: 'Drag a box over the text you want to highlight.',
  rect: 'Drag to draw a box. Hold Shift for a square.',
  ellipse: 'Drag to draw an ellipse. Hold Shift for a circle.',
  line: 'Drag to draw a line. Hold Shift to snap to 45°.',
  arrow: 'Drag to draw an arrow. Hold Shift to snap to 45°.',
  whiteout:
    'Drag to cover content with white, then add new text on top. Note: this hides content visually; the original text is still inside the file.',
  image: 'Click on a page to place the image.',
  signature: 'Click on a page to place your signature.',
  note: 'Click anywhere on a page to add a comment.',
  edit: 'Click any text in the PDF to change it, or click a picture to move, resize, replace or delete it. The original content is replaced in the file itself.',
};

function Swatches({ colors, value, onPick, onNone }: { colors: string[]; value: string | null; onPick: (c: string) => void; onNone?: () => void }) {
  return (
    <div className="swatches" role="radiogroup">
      {onNone && <button className="swatch swatch-none" role="radio" aria-checked={value === null} aria-label="No fill" onClick={onNone} />}
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value?.toLowerCase() === c.toLowerCase()}
          aria-label={c}
          className="swatch"
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="swatch swatch-custom" title="Custom color">
        <input type="color" value={value ?? '#000000'} onChange={(e) => onPick(e.target.value)} aria-label="Custom color" />
      </label>
    </div>
  );
}

/** A range input whose drag becomes a single undo step. */
function Slider(props: { label: string; min: number; max: number; step: number; value: number; unit?: string; onChange: (v: number) => void; gesture?: boolean }) {
  const st = useStore.getState;
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        <span className="field-value">
          {props.unit === '%' ? Math.round(props.value * 100) : props.value}
          {props.unit}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={() => props.gesture && st().beginGesture()}
        onPointerUp={() => props.gesture && st().endGesture()}
        onKeyDown={() => props.gesture && !st().gestureBase && st().beginGesture()}
        onKeyUp={() => props.gesture && st().endGesture()}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

const MARKUP_KINDS: { kind: MarkupKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'highlight', label: 'Highlight', icon: <Highlighter size={15} /> },
  { kind: 'underline', label: 'Underline', icon: <Underline size={15} /> },
  { kind: 'strikeout', label: 'Strike out', icon: <Strikethrough size={15} /> },
];

/** Note text, colour and kind for sticky notes and text markups. */
function CommentEditor({ pageId, ann }: { pageId: string; ann: NoteAnn | MarkupAnn }) {
  const focusNote = useStore((s) => s.focusNote);
  const ref = useRef<HTMLTextAreaElement>(null);
  const st = useStore.getState;
  useEffect(() => {
    if (focusNote === ann.id) {
      ref.current?.focus();
      st().setFocusNote(null);
    }
  }, [focusNote, ann.id, st]);
  const update = (fn: (a: NoteAnn | MarkupAnn) => NoteAnn | MarkupAnn, live = false) =>
    st().updateAnnotation(pageId, ann.id, (a) => fn(a as NoteAnn | MarkupAnn), { live: live || !!st().gestureBase });
  const text = ann.type === 'note' ? ann.text : ann.note;
  const marker = ann.type === 'note' || ann.kind === 'highlight';
  const date = new Date(ann.modified || ann.created);
  return (
    <>
      <h2 className="panel-title">{ann.type === 'note' ? 'Sticky note' : MARKUP_KINDS.find((k) => k.kind === ann.kind)!.label}</h2>
      {ann.type === 'markup' && (
        <>
          <blockquote className="quote" dir="auto">{ann.quotedText}</blockquote>
          <div className="seg" role="radiogroup" aria-label="Style">
            {MARKUP_KINDS.map((k) => (
              <button
                key={k.kind}
                role="radio"
                aria-checked={ann.kind === k.kind}
                className={ann.kind === k.kind ? 'on' : ''}
                title={k.label}
                onClick={() =>
                  update((a) => {
                    const m = a as MarkupAnn;
                    const color = k.kind === 'highlight' ? (MARKERS.includes(m.color) ? m.color : MARKERS[0]) : MARKERS.includes(m.color) ? (k.kind === 'underline' ? '#2F5BEA' : '#C2362B') : m.color;
                    return { ...m, kind: k.kind, color, modified: new Date().toISOString() };
                  })
                }
              >
                {k.icon}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="field">
        <span className="field-label">Color</span>
        <Swatches colors={marker ? MARKERS : INK} value={ann.color} onPick={(c) => update((a) => ({ ...a, color: c }))} />
      </div>
      <label className="field">
        <span className="field-label">Note</span>
        <textarea
          ref={ref}
          className="note-input"
          dir="auto"
          rows={4}
          placeholder={ann.type === 'note' ? 'Write a comment' : 'Add a note about this text'}
          value={text}
          onFocus={() => !st().gestureBase && st().beginGesture()}
          onBlur={() => st().endGesture()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            const now = new Date().toISOString();
            update((a) => (a.type === 'note' ? { ...a, text: v, modified: now } : { ...a, note: v, modified: now }), true);
          }}
        />
      </label>
      <p className="meta">
        {ann.author || 'You'}, {isNaN(date.getTime()) ? '' : date.toLocaleString()}
      </p>
      <div className="panel-actions">
        <button className="btn btn-danger" onClick={() => st().removeAnnotation(pageId, ann.id)}>
          <Trash2 size={15} /> Delete
        </button>
      </div>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl C / Ctrl V', 'Copy and paste text or items'],
  ['Ctrl A', 'Select all text on the page'],
  ['Double-click', 'Select a word'],
  ['Ctrl Z / Ctrl Y', 'Undo / redo'],
  ['Ctrl F', 'Find'],
  ['E', 'Edit the PDF’s own text'],
  ['T / N', 'Add text / sticky note'],
  ['Page Up / Down', 'Previous / next page'],
  ['Ctrl S', 'Save PDF'],
];

function Shortcuts() {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(([k, v]) => (
        <div key={k}>
          <dt>
            <kbd>{k}</kbd>
          </dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** In Edit mode, offers OCR when the current page has no real text (a scan). */
function ScanNotice() {
  const page = useStore((s) => s.present.pages.find((p) => p.id === s.activePageId) ?? s.present.pages[0]);
  const hasOcr = useStore((s) => (page ? !!s.ocr[ocrKey(page)] : false));
  const [noText, setNoText] = useState(false);
  useEffect(() => {
    let alive = true;
    setNoText(false);
    if (!page) return;
    if (!page.docId) {
      setNoText(true);
      return;
    }
    getAnalysis(page).then((a) => alive && setNoText(!!a && a.segments.length === 0));
    return () => {
      alive = false;
    };
  }, [page]);
  if (!noText || hasOcr) return null;
  return (
    <div className="notice">
      <p style={{ margin: '0 0 0.6rem' }}>This page has no text to edit. If it's a scan or a photo, recognize its text first.</p>
      <button className="btn" onClick={() => useStore.getState().openDialog('ocr')}>
        <ScanText size={15} /> Recognize text (OCR)
      </button>
    </div>
  );
}

export function PropertiesPanel() {
  const tool = useStore((s) => s.tool);
  const style = useStore((s) => s.style);
  const selection = useStore((s) => s.selection);
  const ann = useStore((s) => (s.selection ? s.present.annotations[s.selection.pageId]?.find((a) => a.id === s.selection!.annId) : undefined));
  const selectedPages = useStore((s) => s.selectedPages);
  const st = useStore.getState;

  // ----- Selected annotation -----
  const update = (patch: (a: Annotation) => Annotation, live = false) => {
    if (!selection) return;
    st().updateAnnotation(selection.pageId, selection.annId, patch, { live: live || !!st().gestureBase });
  };

  const cropping = useStore((s) => s.cropping);
  let body: React.ReactNode;
  if (ann && selection && (ann.type === 'note' || ann.type === 'markup')) {
    body = <CommentEditor pageId={selection.pageId} ann={ann} />;
  } else if (ann && selection && cropping?.annId === ann.id) {
    body = (
      <>
        <h2 className="panel-title">Crop image</h2>
        <p className="hint">Drag the corners to choose what to keep, or drag the frame to move it. Press Enter when you're done.</p>
        <div className="panel-actions">
          <button className="btn" onClick={cancelCrop}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={applyCrop}>
            Done
          </button>
        </div>
      </>
    );
  } else if (ann && selection) {
    const t = ann.type;
    const colorOf = (a: Annotation): string | null =>
      a.type === 'text' || a.type === 'ink' || a.type === 'line' || a.type === 'arrow'
        ? a.color
        : a.type === 'highlight'
          ? a.fill
          : a.type === 'rect' || a.type === 'ellipse'
            ? a.stroke
            : null;
    const setColor = (c: string) =>
      update((a) => {
        if (a.type === 'text' || a.type === 'ink' || a.type === 'line' || a.type === 'arrow') return { ...a, color: c };
        if (a.type === 'highlight') return { ...a, fill: c };
        if (a.type === 'rect' || a.type === 'ellipse') return { ...a, stroke: c, strokeWidth: a.strokeWidth || 2 };
        return a;
      });
    const isMarker = t === 'highlight' || (t === 'ink' && ann.highlighter);

    body = (
      <>
        <h2 className="panel-title">
          {ANN_NAMES[t]}
          {(ann.type === 'text' || ann.type === 'image') && ann.source ? ' from the PDF' : ''}
        </h2>
        {colorOf(ann) !== null && (
          <div className="field">
            <span className="field-label">{t === 'rect' || t === 'ellipse' ? 'Outline' : 'Color'}</span>
            <Swatches colors={isMarker ? MARKERS : INK} value={colorOf(ann)} onPick={setColor} />
          </div>
        )}
        {(t === 'rect' || t === 'ellipse') && (
          <div className="field">
            <span className="field-label">Fill</span>
            <Swatches colors={INK.slice(0, 6)} value={ann.fill} onPick={(c) => update((a) => ({ ...a, fill: c }))} onNone={() => update((a) => ({ ...a, fill: null }))} />
          </div>
        )}
        {(t === 'ink' || t === 'line' || t === 'arrow' || t === 'rect' || t === 'ellipse') && (
          <Slider
            label="Thickness"
            min={t === 'rect' || t === 'ellipse' ? 0 : 0.5}
            max={ann.type === 'ink' && ann.highlighter ? 40 : 20}
            step={0.5}
            unit="pt"
            gesture
            value={'width' in ann ? ann.width : ann.strokeWidth}
            onChange={(v) => update((a) => ('width' in a ? { ...a, width: v } : { ...a, strokeWidth: v }) as Annotation, true)}
          />
        )}
        {t === 'text' && (
          <>
            <div className="field">
              <span className="field-label">Font</span>
              <div className="row">
                <select
                  value={ann.source?.useOriginal ? 'original' : ann.font}
                  onChange={(e) => {
                    const v = e.target.value;
                    update((a) => {
                      const ta = a as typeof ann;
                      if (v === 'original') return { ...ta, source: ta.source && { ...ta.source, useOriginal: true } };
                      return { ...ta, font: v as FontFamily, source: ta.source && { ...ta.source, useOriginal: false } };
                    });
                  }}
                  aria-label="Font"
                >
                  {ann.source && <option value="original">Original ({ann.source.fontName})</option>}
                  <option value="Helvetica">Sans (Helvetica)</option>
                  <option value="Times">Serif (Times)</option>
                  <option value="Courier">Mono (Courier)</option>
                </select>
                <button
                  className={`icon-toggle ${ann.bold && !ann.source?.useOriginal ? 'on' : ''}`}
                  aria-pressed={ann.bold}
                  aria-label="Bold"
                  onClick={() => update((a) => ({ ...(a as typeof ann), bold: !(a as typeof ann).bold, source: ann.source && { ...ann.source, useOriginal: false } }))}
                >
                  <Bold size={15} />
                </button>
                <button
                  className={`icon-toggle ${ann.italic && !ann.source?.useOriginal ? 'on' : ''}`}
                  aria-pressed={ann.italic}
                  aria-label="Italic"
                  onClick={() => update((a) => ({ ...(a as typeof ann), italic: !(a as typeof ann).italic, source: ann.source && { ...ann.source, useOriginal: false } }))}
                >
                  <Italic size={15} />
                </button>
              </div>
              {ann.source?.useOriginal && !usesOriginalFont(ann) && (
                <p className="notice">
                  The file only contains the letters it already uses from {ann.source.fontName}, and your text needs others, so a similar
                  font ({ann.font === 'Times' ? 'Times' : ann.font === 'Courier' ? 'Courier' : 'Helvetica'}) is used for this line.
                </p>
              )}
            </div>
            <Slider label="Size" min={6} max={96} step={1} unit="pt" gesture value={ann.fontSize} onChange={(v) => update((a) => ({ ...a, fontSize: v }), true)} />
            <Slider label="Angle" min={-180} max={180} step={1} unit="°" gesture value={Math.round(ann.angle)} onChange={(v) => update((a) => ({ ...a, angle: v }), true)} />
          </>
        )}
        {t !== 'whiteout' && !((ann.type === 'text' && ann.source?.useOriginal) || (ann.type === 'image' && ann.source?.name)) && (
          <Slider label="Opacity" min={0.1} max={1} step={0.05} unit="%" gesture value={ann.opacity} onChange={(v) => update((a) => ({ ...a, opacity: v }), true)} />
        )}
        {t === 'image' && (
          <div className="panel-actions">
            <button className="btn" onClick={() => startCrop(selection.pageId, ann.id)}>
              <Crop size={15} /> Crop
            </button>
            {ann.crop && (
              <button className="btn" onClick={() => resetCrop(selection.pageId, ann.id)}>
                Show whole image
              </button>
            )}
          </div>
        )}
        {t === 'image' && (
          <button
            className="btn"
            onClick={async () => {
              const [file] = await pickFiles(ACCEPT_IMAGES, false);
              if (!file) return;
              const img = await loadImage(file);
              // Keep the width, follow the new picture's proportions.
              update((a) => {
                const ia = a as typeof ann;
                return { ...ia, imageId: img.id, source: undefined, crop: undefined, h: (ia.w * img.height) / img.width };
              });
            }}
          >
            <ImageUp size={15} /> Replace image…
          </button>
        )}
        <div className="panel-actions">
          <button className="btn" title="Bring to front" onClick={() => st().reorderAnnotation(selection.pageId, ann.id, 'front')}>
            <ArrowUpToLine size={15} /> To front
          </button>
          <button className="btn" title="Send to back" onClick={() => st().reorderAnnotation(selection.pageId, ann.id, 'back')}>
            <ArrowDownToLine size={15} /> To back
          </button>
        </div>
        <div className="panel-actions">
          <button
            className="btn"
            onClick={() => {
              const copy = { ...moveAnn(ann, 12, 12), id: uid('ann') };
              st().addAnnotation(selection.pageId, copy);
              st().select({ pageId: selection.pageId, annId: copy.id });
            }}
          >
            <Copy size={15} /> Duplicate
          </button>
          <button className="btn btn-danger" onClick={() => st().removeAnnotation(selection.pageId, selection.annId)}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </>
    );
  } else {
    // ----- Tool defaults -----
    const marker = tool === 'highlight' || tool === 'highlighter';
    const showColor = ['text', 'draw', 'rect', 'ellipse', 'line', 'arrow', 'highlight', 'highlighter'].includes(tool);
    const showWidth = ['draw', 'rect', 'ellipse', 'line', 'arrow', 'highlighter'].includes(tool);
    body = (
      <>
        <h2 className="panel-title">{TOOL_NAMES[tool]}</h2>
        {TOOL_HINTS[tool] && <p className="hint">{TOOL_HINTS[tool]}</p>}
        {tool === 'edit' && <ScanNotice />}
        {tool === 'select' && <Shortcuts />}
        {showColor && (
          <div className="field">
            <span className="field-label">Color</span>
            <Swatches
              colors={marker ? MARKERS : INK}
              value={marker ? style.highlightColor : style.color}
              onPick={(c) => st().setStyle(marker ? { highlightColor: c } : { color: c })}
            />
          </div>
        )}
        {(tool === 'rect' || tool === 'ellipse') && (
          <div className="field">
            <span className="field-label">Fill</span>
            <Swatches colors={INK.slice(0, 6)} value={style.fill} onPick={(c) => st().setStyle({ fill: c })} onNone={() => st().setStyle({ fill: null })} />
          </div>
        )}
        {showWidth && (
          <Slider label="Thickness" min={0.5} max={tool === 'highlighter' ? 10 : 20} step={0.5} unit="pt" value={style.strokeWidth} onChange={(v) => st().setStyle({ strokeWidth: v })} />
        )}
        {tool === 'text' && (
          <>
            <div className="field">
              <span className="field-label">Font</span>
              <select value={style.font} onChange={(e) => st().setStyle({ font: e.target.value as FontFamily })} aria-label="Font">
                <option value="Helvetica">Sans (Helvetica)</option>
                <option value="Times">Serif (Times)</option>
                <option value="Courier">Mono (Courier)</option>
              </select>
            </div>
            <Slider label="Size" min={6} max={96} step={1} unit="pt" value={style.fontSize} onChange={(v) => st().setStyle({ fontSize: v })} />
          </>
        )}
        {['text', 'draw', 'rect', 'ellipse', 'line', 'arrow'].includes(tool) && (
          <Slider label="Opacity" min={0.1} max={1} step={0.05} unit="%" value={style.opacity} onChange={(v) => st().setStyle({ opacity: v })} />
        )}
      </>
    );
  }

  return (
    <aside className="panel" aria-label="Properties">
      <section className="panel-section">{body}</section>
      {selectedPages.length > 0 && (
        <section className="panel-section">
          <div className="panel-title-row">
            <h2 className="panel-title">
              {selectedPages.length} page{selectedPages.length === 1 ? '' : 's'} selected
            </h2>
            <button className="icon-btn" aria-label="Clear page selection" onClick={() => st().setSelectedPages([])}>
              <X size={15} />
            </button>
          </div>
          <div className="panel-grid">
            <button className="btn" onClick={() => st().rotatePages(selectedPages, -90)}>
              <RotateCcw size={15} /> Rotate left
            </button>
            <button className="btn" onClick={() => st().rotatePages(selectedPages, 90)}>
              <RotateCw size={15} /> Rotate right
            </button>
            <button className="btn" onClick={() => extractPages(selectedPages)}>
              <FileOutput size={15} /> Extract PDF
            </button>
            <button className="btn" onClick={() => exportPagesAsImages(selectedPages)}>
              <FileImage size={15} /> Save PNG
            </button>
            <button
              className="btn btn-danger span-2"
              disabled={selectedPages.length >= useStore.getState().present.pages.length}
              onClick={() => st().deletePages(selectedPages)}
            >
              <Trash2 size={15} /> Delete pages
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
