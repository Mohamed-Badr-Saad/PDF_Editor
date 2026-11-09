// Copies runtime assets into public/ so they're served by the app itself and
// can be cached for offline use:
//   public/pdfjs      pdf.js fonts, cmaps, wasm decoders, ICC profiles
//   public/tesseract  OCR worker, engine (wasm) and English/Arabic language data
//   public/fonts      Noto Sans Arabic (OFL), for Arabic and other non-Latin text
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const pub = join(process.cwd(), 'public');

const pdfjsRoot = pkgDir('pdfjs-dist');
const pdfjsTarget = join(pub, 'pdfjs');
mkdirSync(pdfjsTarget, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = join(pdfjsRoot, dir);
  if (existsSync(src)) cpSync(src, join(pdfjsTarget, dir), { recursive: true });
}

const tess = join(pub, 'tesseract');
mkdirSync(join(tess, 'core'), { recursive: true });
mkdirSync(join(tess, 'lang'), { recursive: true });
cpSync(join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), join(tess, 'worker.min.js'));
// LSTM engine builds only (plain, SIMD and relaxed-SIMD; the worker picks the best one).
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  cpSync(join(pkgDir('tesseract.js-core'), f), join(tess, 'core', f));
}
for (const lang of ['eng', 'ara']) {
  cpSync(join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`), join(tess, 'lang', `${lang}.traineddata.gz`));
}
// Unicode font (Arabic + Latin) used when text needs more than the standard PDF fonts.
const fontsTarget = join(pub, 'fonts');
mkdirSync(fontsTarget, { recursive: true });
const noto = pkgDir('@expo-google-fonts/noto-sans-arabic');
cpSync(join(noto, '400Regular', 'NotoSansArabic_400Regular.ttf'), join(fontsTarget, 'NotoSansArabic-Regular.ttf'));
cpSync(join(noto, '700Bold', 'NotoSansArabic_700Bold.ttf'), join(fontsTarget, 'NotoSansArabic-Bold.ttf'));

console.log('Assets copied to public/pdfjs, public/tesseract and public/fonts');
