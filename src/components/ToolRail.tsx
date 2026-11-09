import {
  ArrowUpRight,
  FilePenLine,
  MessageSquarePlus,
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  PenLine,
  Signature,
  Square,
  SquareDashed,
  Type,
} from 'lucide-react';
import { useStore } from '../state/store';
import type { Tool } from '../lib/types';
import { ACCEPT_IMAGES, loadImage, pickFiles } from '../lib/importFiles';

interface ToolDef {
  id: Tool;
  label: string;
  key?: string;
  icon: React.ReactNode;
}

const GROUPS: ToolDef[][] = [
  [
    { id: 'select', label: 'Select text and items', key: 'V', icon: <MousePointer2 size={19} /> },
    { id: 'edit', label: 'Edit PDF text & images', key: 'E', icon: <FilePenLine size={19} /> },
    { id: 'text', label: 'Add text', key: 'T', icon: <Type size={19} /> },
  ],
  [
    { id: 'note', label: 'Sticky-note comment', key: 'N', icon: <MessageSquarePlus size={19} /> },
  ],
  [
    { id: 'draw', label: 'Pen', key: 'P', icon: <PenLine size={19} /> },
    { id: 'highlighter', label: 'Highlighter pen', key: 'H', icon: <Highlighter size={19} /> },
    { id: 'highlight', label: 'Highlight area', key: 'M', icon: <SquareDashed size={19} /> },
  ],
  [
    { id: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={19} /> },
    { id: 'ellipse', label: 'Ellipse', key: 'O', icon: <Circle size={19} /> },
    { id: 'line', label: 'Line', key: 'L', icon: <Minus size={19} /> },
    { id: 'arrow', label: 'Arrow', key: 'A', icon: <ArrowUpRight size={19} /> },
  ],
  [
    { id: 'whiteout', label: 'White-out', key: 'W', icon: <Eraser size={19} /> },
    { id: 'image', label: 'Image', key: 'I', icon: <ImagePlus size={19} /> },
    { id: 'signature', label: 'Signature', key: 'S', icon: <Signature size={19} /> },
  ],
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  GROUPS.flat()
    .filter((t) => t.key)
    .map((t) => [t.key!.toLowerCase(), t.id]),
);

export async function activateTool(id: Tool, openSignature: () => void) {
  const st = useStore.getState();
  if (id === 'image') {
    const [file] = await pickFiles(ACCEPT_IMAGES, false);
    if (!file) return;
    try {
      const img = await loadImage(file);
      st.setPendingImage(img.id);
      st.setTool('image');
      st.toast('Click on a page to place the image.');
    } catch {
      st.toast(`Couldn't read "${file.name}" as an image.`, 'error');
    }
    return;
  }
  if (id === 'signature') {
    openSignature();
    return;
  }
  st.setPendingImage(null);
  st.setTool(id);
}

export function ToolRail({ onSignature }: { onSignature(): void }) {
  const tool = useStore((s) => s.tool);
  return (
    <nav className="rail" aria-label="Tools">
      {GROUPS.map((g, i) => (
        <div className="rail-group" key={i}>
          {g.map((t) => (
            <button
              key={t.id}
              className={`rail-btn ${tool === t.id ? 'is-active' : ''}`}
              aria-pressed={tool === t.id}
              aria-label={t.label}
              data-tip={t.label}
              data-tip-key={t.key}
              onClick={() => activateTool(t.id, onSignature)}
            >
              {t.icon}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
