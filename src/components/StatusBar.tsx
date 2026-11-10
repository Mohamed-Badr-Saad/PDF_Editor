import { ShieldCheck } from 'lucide-react';
import { Credit } from './Credit';

/** Thin bar under the editor: a privacy reminder and who made PageCraft. */
export function StatusBar() {
  return (
    <footer className="statusbar">
      <span className="status-privacy">
        <ShieldCheck size={14} aria-hidden /> Your files stay on this device
      </span>
      <Credit className="status-credit" />
    </footer>
  );
}
