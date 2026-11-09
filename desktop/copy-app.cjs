// Copies the built web app (../dist) into ./app, where the desktop shell loads it from.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'dist');
const dest = path.join(__dirname, 'app');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('No web build found. Run "npm run build" in the project folder first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, {
  recursive: true,
  // The desktop app has every file locally, so the offline service worker isn't needed.
  filter: (p) => !/(^|[\\/])(sw\.js|workbox-[^\\/]*\.js|registerSW\.js)$/.test(p),
});
console.log('Copied web app to desktop/app');
