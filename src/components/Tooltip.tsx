import { useEffect, useState } from 'react';

/**
 * One tooltip for the whole app. Shows the `data-tip` (and optional
 * `data-tip-key` shortcut) of whatever is hovered or focused, positioned on
 * screen so it's never cut off by a scrolling panel.
 */
export function Tooltip() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; side: 'right' | 'below' } | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
      window.clearTimeout(timer);
      if (!el) {
        setTip(null);
        return;
      }
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const side = el.closest('.rail') ? 'right' : 'below';
        setTip({
          text: el.dataset.tip!,
          key: el.dataset.tipKey,
          x: side === 'right' ? r.right + 8 : r.left + r.width / 2,
          y: side === 'right' ? r.top + r.height / 2 : r.bottom + 8,
          side,
        });
      }, 250);
    };
    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className={`tooltip tooltip-${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  );
}
