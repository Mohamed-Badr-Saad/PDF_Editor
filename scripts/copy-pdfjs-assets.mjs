// Copies pdf.js runtime assets (fonts, cmaps, wasm decoders, ICC profiles) into
// public/pdfjs so they are served locally and cached for offline use.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(process.cwd(), 'public', 'pdfjs');
mkdirSync(target, { recursive: true });

for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = join(pdfjsRoot, dir);
  if (existsSync(src)) cpSync(src, join(target, dir), { recursive: true });
}
console.log('pdf.js assets copied to public/pdfjs');
