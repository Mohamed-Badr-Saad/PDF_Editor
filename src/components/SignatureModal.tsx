import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { loadImage, pickFiles, ACCEPT_IMAGES } from '../lib/importFiles';
import { useStore } from '../state/store';

const SAVED_KEY = 'pagecraft.signatures';
const COLORS = ['#000000', '#1B2A41', '#2F5BEA'];

function readSaved(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeSaved(list: string[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 4)));
  } catch {
    /* storage unavailable: signatures just won't be remembered */
  }
}

/** Crops transparent margins from a canvas and returns a PNG blob. */
function trimCanvas(src: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = src.getContext('2d')!;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return Promise.resolve(null);
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((r) => out.toBlob(r, 'image/png'));
}

export function SignatureModal({ onClose }: { onClose(): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [empty, setEmpty] = useState(true);
  const [remember, setRemember] = useState(true);
  const [saved, setSaved] = useState<string[]>(readSaved);
  const drawing = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const use = async (blob: Blob) => {
    const img = await loadImage(blob);
    const st = useStore.getState();
    st.setPendingImage(img.id);
    st.setTool('signature');
    st.toast('Click on a page to place your signature.');
    onClose();
  };

  const done = async () => {
    const blob = await trimCanvas(canvasRef.current!);
    if (!blob) return;
    if (remember) {
      const url = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.readAsDataURL(blob);
      });
      writeSaved([url, ...saved.filter((s) => s !== url)]);
    }
    await use(blob);
  };

  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  return (
    <Modal
      title="Create signature"
      onClose={onClose}
      wide
      footer={
        <>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember on this device
          </label>
          <span className="spacer" />
          <button
            className="btn"
            onClick={async () => {
              const [f] = await pickFiles(ACCEPT_IMAGES, false);
              if (f) use(f);
            }}
          >
            Upload image
          </button>
          <button className="btn btn-primary" disabled={empty} onClick={done}>
            Use signature
          </button>
        </>
      }
    >
      {saved.length > 0 && (
        <div className="saved-sigs">
          <span className="field-label">Saved signatures</span>
          <div className="saved-sig-list">
            {saved.map((url) => (
              <div key={url} className="saved-sig">
                <button className="saved-sig-use" onClick={async () => use(await (await fetch(url)).blob())} aria-label="Use this signature">
                  <img src={url} alt="Saved signature" />
                </button>
                <button
                  className="saved-sig-remove"
                  aria-label="Forget this signature"
                  onClick={() => {
                    const next = saved.filter((s) => s !== url);
                    writeSaved(next);
                    setSaved(next);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="sig-pad-wrap">
        <canvas
          ref={canvasRef}
          className="sig-pad"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            drawing.current = pos(e);
            const ctx = canvasRef.current!.getContext('2d')!;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(drawing.current.x, drawing.current.y, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = pos(e);
            const ctx = canvasRef.current!.getContext('2d')!;
            ctx.strokeStyle = color;
            // Slightly thinner strokes when moving fast, like a real pen.
            const speed = Math.hypot(p.x - drawing.current.x, p.y - drawing.current.y);
            ctx.lineWidth = Math.max(1.4, 3.2 - speed * 0.08) * (e.pressure && e.pointerType === 'pen' ? 0.6 + e.pressure : 1);
            ctx.beginPath();
            ctx.moveTo(drawing.current.x, drawing.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            drawing.current = p;
            if (empty) setEmpty(false);
          }}
          onPointerUp={() => (drawing.current = null)}
        />
        <div className="sig-baseline" aria-hidden />
        <div className="sig-tools">
          {COLORS.map((c) => (
            <button key={c} className="swatch" style={{ background: c }} aria-checked={c === color} role="radio" aria-label={`Ink ${c}`} onClick={() => setColor(c)} />
          ))}
          <button className="btn btn-quiet" onClick={clear} disabled={empty}>
            Clear
          </button>
        </div>
        {empty && <p className="sig-placeholder">Sign here with your mouse, finger or stylus</p>}
      </div>
    </Modal>
  );
}
