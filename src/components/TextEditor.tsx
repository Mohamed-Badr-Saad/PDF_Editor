import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { reflowLine } from '../lib/content/editorBridge';
import type { TextAnn } from '../lib/types';
import { BASELINE, LINE_HEIGHT, baselineOf, fontStackOf, measureText } from '../lib/geometry';
import { baseDirection } from '../lib/bidi';

interface Props {
  pageId: string;
  ann: TextAnn;
  zoom: number;
}

/** In-place textarea for typing into a text annotation. */
export function TextEditor({ pageId, ann, zoom }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    const st = useStore.getState();
    if (!st.gestureBase) st.beginGesture();
  }, []);

  useEffect(() => {
    // Focus after the pointer sequence that created us has finished.
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    const st = useStore.getState();
    const current = st.present.annotations[pageId]?.find((a) => a.id === ann.id) as TextAnn | undefined;
    const base = st.gestureBase;
    const existedBefore = base?.annotations[pageId]?.some((a) => a.id === ann.id);
    // Text taken from the PDF itself or from OCR of a scan.
    const original = current?.source ? current.source.originalText : current?.ocrText;
    const fromPdf = original !== undefined;
    if (fromPdf && !existedBefore && current!.text === original) {
      // Clicked into the text but changed nothing: leave the file untouched.
      if (base) st.live(() => base);
    } else if (current && !current.text.trim()) {
      if (current.source) reflowLine(pageId, ann.id); // close the gap before the item goes
      if (fromPdf) {
        // Text from the PDF was cleared: keep it removed from the page.
        st.live((s) => ({ ...s, annotations: { ...s.annotations, [pageId]: s.annotations[pageId].filter((a) => a.id !== ann.id) } }));
      } else if (base && !existedBefore) st.live(() => base);
      else st.live((s) => ({ ...s, annotations: { ...s.annotations, [pageId]: s.annotations[pageId].filter((a) => a.id !== ann.id) } }));
      st.select(null);
    } else if (current?.source) {
      // Edited PDF text: push the rest of its line along by the change in width.
      reflowLine(pageId, ann.id);
    }
    st.endGesture();
    st.setEditingText(null);
  };

  // Commit if the editor unmounts for any other reason (page change, tool switch).
  useEffect(() => () => finish(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const { w, h } = measureText(ann);
  // Right-to-left text grows to the left from the box's right edge, as on the page.
  const rtl = baseDirection(ann.text) === 'rtl';
  const pad = ann.fontSize * (rtl ? 1 : 1.5);
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={ann.text}
      spellCheck
      dir={baseDirection(ann.text) === 'rtl' ? 'rtl' : 'auto'}
      placeholder="Type here"
      onChange={(e) => {
        const text = e.target.value;
        useStore.getState().updateAnnotation(
          pageId,
          ann.id,
          (a) => {
            const t = a as TextAnn;
            const next = { ...t, text };
            if (baseDirection(text) !== 'rtl') return next;
            // Right-to-left text keeps its right edge still while typing.
            const shift = measureText(t).w - measureText(next).w;
            const rad = (t.angle * Math.PI) / 180;
            return { ...next, x: t.x + shift * Math.cos(rad), y: t.y + shift * Math.sin(rad) };
          },
          { live: true },
        );
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      style={{
        left: (rtl ? ann.x - pad : ann.x) * zoom,
        top: ann.y * zoom,
        width: (w + pad) * zoom,
        textAlign: rtl ? 'right' : undefined,
        transformOrigin: rtl ? `${pad * zoom}px 0` : undefined,
        height: Math.max(h, ann.fontSize * LINE_HEIGHT) * zoom + 2,
        minWidth: 90,
        // Rotate with the text, then shift so the textarea baseline matches the PDF baseline.
        transform: `rotate(${ann.angle || 0}deg) translateY(${(baselineOf(ann) - BASELINE[ann.font]) * ann.fontSize * zoom}px)`,
        font: `${ann.italic ? 'italic ' : ''}${ann.bold ? 700 : 400} ${ann.fontSize * zoom}px/${LINE_HEIGHT} ${fontStackOf(ann)}`,
        background: ann.source ? '#fff' : undefined,
        color: ann.color,
        opacity: ann.opacity,
      }}
    />
  );
}
