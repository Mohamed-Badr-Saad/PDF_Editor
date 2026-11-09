import { useState } from 'react';
import { Modal } from './Modal';
import { addPageNumbers, addWatermark, type PageNumberOptions } from '../lib/actions';

export function WatermarkDialog({ onClose }: { onClose(): void }) {
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState(60);
  const [color, setColor] = useState('#C2362B');
  const [opacity, setOpacity] = useState(0.2);
  const [diagonal, setDiagonal] = useState(true);
  return (
    <Modal
      title="Add watermark"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => {
              addWatermark({ text: text.trim(), fontSize, color, opacity, diagonal });
              onClose();
            }}
          >
            Add to all pages
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Text</span>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="row gap">
        <label className="field grow">
          <span className="field-label">
            Size <span className="field-value">{fontSize}pt</span>
          </span>
          <input type="range" min={16} max={140} value={fontSize} onChange={(e) => setFontSize(+e.target.value)} />
        </label>
        <label className="field grow">
          <span className="field-label">
            Opacity <span className="field-value">{Math.round(opacity * 100)}%</span>
          </span>
          <input type="range" min={0.05} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
        </label>
      </div>
      <div className="row gap">
        <label className="field">
          <span className="field-label">Color</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={diagonal} onChange={(e) => setDiagonal(e.target.checked)} />
          Diagonal
        </label>
      </div>
      <div className="wm-preview" aria-hidden>
        <span style={{ color, opacity, transform: diagonal ? 'rotate(-54deg)' : undefined, fontSize: fontSize / 4 }}>{text}</span>
      </div>
    </Modal>
  );
}

export function PageNumbersDialog({ onClose }: { onClose(): void }) {
  const [o, setO] = useState<PageNumberOptions>({ format: 'n-of-total', position: 'bottom-center', fontSize: 10, startAt: 1 });
  const set = (p: Partial<PageNumberOptions>) => setO({ ...o, ...p });
  return (
    <Modal
      title="Add page numbers"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              addPageNumbers(o);
              onClose();
            }}
          >
            Add page numbers
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Format</span>
        <select value={o.format} onChange={(e) => set({ format: e.target.value as PageNumberOptions['format'] })}>
          <option value="n">1</option>
          <option value="page-n">Page 1</option>
          <option value="n-of-total">1 of 10</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Position</span>
        <select value={o.position} onChange={(e) => set({ position: e.target.value as PageNumberOptions['position'] })}>
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-right">Bottom right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="top-right">Top right</option>
        </select>
      </label>
      <div className="row gap">
        <label className="field grow">
          <span className="field-label">Font size</span>
          <input type="number" min={6} max={36} value={o.fontSize} onChange={(e) => set({ fontSize: Math.max(6, +e.target.value || 10) })} />
        </label>
        <label className="field grow">
          <span className="field-label">Start at</span>
          <input type="number" min={0} value={o.startAt} onChange={(e) => set({ startAt: Math.max(0, +e.target.value || 0) })} />
        </label>
      </div>
    </Modal>
  );
}
