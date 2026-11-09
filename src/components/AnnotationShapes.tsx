import { memo } from 'react';
import type { Annotation, StoredImage } from '../lib/types';
import { LINE_HEIGHT, NOTE_SIZE, arrowHead, arrowShaftEnd, baselineOf, cssFontFamily, fullImageBox, inkPath, measureText } from '../lib/geometry';

interface Props {
  annotations: Annotation[];
  images: Record<string, StoredImage>;
  /** Hidden annotation (e.g. text currently being edited in a textarea). */
  hiddenId?: string | null;
  /** Adds invisible, wider hit targets for selection. */
  interactive?: boolean;
  /** Text from the PDF itself is drawn in the page canvas; while it's dragged, show a ghost here. */
  ghostId?: string | null;
  scale: number;
}

/** Pure SVG rendering of annotations in base-space coordinates. */
export const AnnotationShapes = memo(function AnnotationShapes({ annotations, images, hiddenId, interactive, ghostId, scale }: Props) {
  const hitWidth = 12 / scale;
  return (
    <>
      {annotations.map((a) => {
        if (a.id === hiddenId) return null;
        const common = { 'data-ann-id': a.id, opacity: a.opacity, className: interactive ? `ann ann-${a.type}` : undefined };
        switch (a.type) {
          case 'text': {
            const { w, h } = measureText(a);
            const transform = a.angle ? `rotate(${a.angle} ${a.x} ${a.y})` : undefined;
            // Original PDF text is rendered by the page canvas itself (exact font).
            if (a.source && a.id !== ghostId) {
              return interactive ? (
                <g key={a.id} {...common} opacity={undefined} transform={transform}>
                  <rect x={a.x} y={a.y} width={w} height={h} fill="transparent" />
                </g>
              ) : null;
            }
            const base = baselineOf(a);
            return (
              <g key={a.id} {...common} opacity={a.id === ghostId ? 0.55 : a.opacity} transform={transform}>
                {interactive && <rect x={a.x} y={a.y} width={w} height={h} fill="transparent" />}
                <text
                  fill={a.color}
                  fontFamily={cssFontFamily[a.font]}
                  fontSize={a.fontSize}
                  fontWeight={a.bold ? 700 : 400}
                  fontStyle={a.italic ? 'italic' : 'normal'}
                  style={{ whiteSpace: 'pre' }}
                >
                  {a.text.split('\n').map((line, i) => (
                    <tspan key={i} x={a.x} y={a.y + a.fontSize * (base + i * LINE_HEIGHT)}>
                      {line || ' '}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          }
          case 'ink': {
            const d = inkPath(a.points);
            return (
              <g key={a.id} {...common} style={a.highlighter ? { mixBlendMode: 'multiply' } : undefined}>
                <path d={d} fill="none" stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
                {interactive && <path d={d} fill="none" stroke="transparent" strokeWidth={Math.max(a.width, hitWidth)} strokeLinecap="round" />}
              </g>
            );
          }
          case 'rect':
          case 'highlight':
          case 'whiteout':
            return (
              <rect
                key={a.id}
                {...common}
                x={a.x}
                y={a.y}
                width={a.w}
                height={a.h}
                fill={a.fill ?? (interactive ? 'transparent' : 'none')}
                stroke={a.stroke ?? undefined}
                strokeWidth={a.stroke ? a.strokeWidth : 0}
                style={a.type === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
              />
            );
          case 'ellipse':
            return (
              <ellipse
                key={a.id}
                {...common}
                cx={a.x + a.w / 2}
                cy={a.y + a.h / 2}
                rx={a.w / 2}
                ry={a.h / 2}
                fill={a.fill ?? (interactive ? 'transparent' : 'none')}
                stroke={a.stroke ?? undefined}
                strokeWidth={a.stroke ? a.strokeWidth : 0}
              />
            );
          case 'line':
          case 'arrow': {
            const [ex, ey] = a.type === 'arrow' ? arrowShaftEnd(a) : [a.x2, a.y2];
            return (
              <g key={a.id} {...common}>
                <line x1={a.x1} y1={a.y1} x2={ex} y2={ey} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
                {a.type === 'arrow' && <path d={arrowHead(a)} fill={a.color} />}
                {interactive && (
                  <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={Math.max(a.width, hitWidth)} />
                )}
              </g>
            );
          }
          case 'image': {
            const img = images[a.imageId];
            if (!img) return null;
            if (!a.crop) {
              return <image key={a.id} {...common} href={img.url} x={a.x} y={a.y} width={a.w} height={a.h} preserveAspectRatio="none" />;
            }
            // Cropped: show the full picture through a window the size of the visible box.
            const full = fullImageBox(a);
            return (
              <g key={a.id} {...common}>
                <svg x={a.x} y={a.y} width={a.w} height={a.h} viewBox={`${a.x} ${a.y} ${a.w} ${a.h}`} overflow="hidden">
                  <image href={img.url} x={full.x} y={full.y} width={full.w} height={full.h} preserveAspectRatio="none" />
                </svg>
                {interactive && <rect x={a.x} y={a.y} width={a.w} height={a.h} fill="transparent" />}
              </g>
            );
          }
          case 'note':
            return (
              <g key={a.id} {...common} className={interactive ? 'ann ann-note' : undefined}>
                <title>{a.text || 'Empty note'}</title>
                <NoteIcon x={a.x} y={a.y} size={NOTE_SIZE} color={a.color} />
              </g>
            );
          case 'markup': {
            const last = a.quads[a.quads.length - 1];
            return (
              <g key={a.id} {...common} className={interactive ? 'ann ann-markup' : undefined} style={a.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}>
                {a.note && <title>{a.note}</title>}
                {a.quads.map((q, i) =>
                  a.kind === 'highlight' ? (
                    <rect key={i} x={q.x} y={q.y} width={q.w} height={q.h} fill={a.color} />
                  ) : (
                    <g key={i}>
                      <line
                        x1={q.x}
                        x2={q.x + q.w}
                        y1={q.y + q.h * (a.kind === 'underline' ? 0.9 : 0.5)}
                        y2={q.y + q.h * (a.kind === 'underline' ? 0.9 : 0.5)}
                        stroke={a.color}
                        strokeWidth={Math.max(0.6, q.h * 0.07)}
                      />
                      {interactive && <rect x={q.x} y={q.y} width={q.w} height={q.h} fill="transparent" />}
                    </g>
                  ),
                )}
                {a.note && last && <NoteIcon x={last.x + last.w + 1} y={last.y - 7} size={9} color={a.kind === 'highlight' ? '#f2c400' : a.color} />}
              </g>
            );
          }
        }
      })}
    </>
  );
});

/** Speech-bubble icon used for comments. */
export function NoteIcon({ x, y, size, color }: { x: number; y: number; size: number; color: string }) {
  const k = size / 18;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <path d="M3 1.5h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5L4.5 17v-3.5H3a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" fill={color} stroke="#1B2A41" strokeWidth={1.1} strokeLinejoin="round" />
      <path d="M4.5 5.5h9M4.5 8.5h6" stroke="#1B2A41" strokeWidth={1.1} strokeLinecap="round" opacity={0.75} />
    </g>
  );
}
