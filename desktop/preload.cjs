// The only bridge between the desktop shell and the app: receiving PDFs that
// were opened from Explorer/Finder. The app has no other access to the computer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pagecraftDesktop', {
  platform: process.platform,
  /** Registers a handler for files opened with PageCraft, and receives any that are waiting. */
  onOpenFiles(handler) {
    ipcRenderer.on('open-files', (_e, files) => handler(files));
    ipcRenderer.invoke('pagecraft:ready').then((files) => files.length && handler(files));
  },
});
