// "Install app" support. Chrome, Edge and Android fire beforeinstallprompt when
// the app can be installed; iPhone/iPad Safari has no prompt, so we show how
// to use Share → Add to Home Screen instead.
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Call once at start-up, before the browser fires the event. */
export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the browser's mini-bar
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

declare global {
  interface Window {
    /** Present only in the PageCraft desktop app (see desktop/preload.cjs). */
    pagecraftDesktop?: {
      platform: string;
      onOpenFiles(handler: (files: { name: string; data: Uint8Array }[]) => void): void;
    };
  }
}

/** True inside the PageCraft desktop app. */
export const isDesktopApp = () => typeof window !== 'undefined' && 'pagecraftDesktop' in window;

export type InstallState = 'prompt' | 'ios' | 'none';

function getState(): InstallState {
  if (installed || isStandalone() || isDesktopApp()) return 'none';
  if (deferred) return 'prompt';
  return isIos() ? 'ios' : 'none';
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState,
    () => 'none',
  );
}

/** Opens the browser's install dialog. Returns true if the user accepted. */
export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}
