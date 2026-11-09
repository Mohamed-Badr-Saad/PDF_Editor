// PageCraft desktop: the same app as the website, packaged with its own
// window and files so it runs fully offline. Nothing is uploaded anywhere.
const { app, BrowserWindow, Menu, ipcMain, protocol, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, 'app');
const ORIGIN = 'app://pagecraft';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.icc': 'application/octet-stream',
};

// A private, secure scheme so the app's workers, WebAssembly and fetch() calls
// behave exactly as they do on the website.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// ---------- PDFs opened from Explorer / Finder / the command line ----------

let win = null;
let rendererReady = false;
let pending = [];

const pdfArgs = (argv) =>
  argv.filter((a) => /\.(pdf|png|jpe?g|webp|gif|bmp)$/i.test(a) && !a.startsWith('-')).filter((a) => fs.existsSync(a));

function readFiles(paths) {
  return paths.flatMap((p) => {
    try {
      return [{ name: path.basename(p), data: fs.readFileSync(p) }];
    } catch {
      return [];
    }
  });
}

function openFiles(paths) {
  if (!paths.length) return;
  if (win && rendererReady) {
    win.webContents.send('open-files', readFiles(paths));
    if (win.isMinimized()) win.restore();
    win.focus();
  } else pending.push(...paths);
}

// One window: opening another PDF while PageCraft runs sends it to that window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    openFiles(pdfArgs(argv.slice(1)));
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}
app.on('open-file', (e, file) => {
  // macOS: double-clicking a PDF, or dropping it on the Dock icon.
  e.preventDefault();
  openFiles([file]);
});
pending.push(...pdfArgs(process.argv.slice(app.isPackaged ? 1 : 2)));

ipcMain.handle('pagecraft:ready', () => {
  rendererReady = true;
  const files = readFiles(pending);
  pending = [];
  return files;
});

// ---------- window ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 720,
    minHeight: 500,
    title: 'PageCraft',
    backgroundColor: '#DDE3EA',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
    rendererReady = false;
  });

  // Links to websites open in the normal browser; the app itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadURL(`${ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR + path.sep)) return new Response('Not found', { status: 404 });
    try {
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // "Save PDF" asks where to save, starting in Documents.
  session.defaultSession.on('will-download', (_e, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).slice(1).toLowerCase();
    item.setSaveDialogOptions({
      title: 'Save',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : [],
    });
  });

  // No permissions are needed (no camera, location, notifications...).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]),
    );
  } else {
    Menu.setApplicationMenu(null); // the app has its own toolbar and shortcuts
  }

  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
