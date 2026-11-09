# PageCraft PDF Editor

A free PDF editor that runs entirely in the browser. Files are never uploaded; all processing happens on the user's device. After the first visit it also works offline, and it can be installed like a desktop app (PWA).

## Features (v0.5)

**Edit the PDF's own content** (Edit tool, key E)
- Click any line of text in the PDF to retype it. The old text is removed from the file itself (not covered up), so it's gone when the PDF is copied, searched or opened elsewhere
- New text uses the document's own embedded font whenever that font contains the letters you typed; otherwise a similar standard font is used and the panel says so
- Keeps the original size, color, position, rotation and spacing; the rest of the line slides along when the text gets longer or shorter
- Clear a line to delete it
- Click any picture in the PDF to move, resize, replace or delete it. Moved pictures keep their original quality (they're not re-compressed)
- Everything is undoable and previewed exactly as it will be saved

**Scanned documents (OCR)**
- Scanned pages are detected as soon as a document opens, and a bar offers to recognize them (also the OCR button in the top bar)
- Reads scans and photos in English and Arabic. Automatic mode reads mostly-Arabic pages a second time in Arabic only, which avoids Latin junk in Arabic text. Any page that reads badly (low confidence) is retried in the other language, so even "English only" handles an Arabic page. Runs on the device; the reading engine downloads once (about 8 MB) and then works offline
- The saved PDF gets an invisible text layer, so it's searchable and its text can be selected and copied in any reader
- Recognized lines can be edited with the Edit tool. The new text keeps the scan's ink color and weight (bold is detected), and the old words are hidden by a patch made from the surrounding paper, grain included, so the edit blends in. Lines that sit in separate columns (like "Bill to" and "From") are edited separately
- Copy the recognized text or save it as a .txt file

**Arabic**
- Type Arabic anywhere (text boxes, edited lines, comments). Letters are joined and lines with Arabic, English and numbers are laid out correctly, using the bundled Noto Sans Arabic font (OFL), on screen and in the saved PDF
- Edit Arabic text in PDFs and in recognized scans; the right edge stays in place, as Arabic readers expect
- Arabic text from PDFs is converted to reading order for editing, copying and Find

**Comments and review**
- The default Select tool (V) selects text: drag across it to highlight, underline or strike it out, attach a note, or copy it (also Ctrl+C). Double-click selects a word, triple-click a line, Ctrl+A the whole page. Works on scans after OCR too
- Sticky notes (N) anywhere on a page
- Comments panel listing every comment, including ones already in the PDF from Acrobat, Edge, Preview and others
- Export notes to CSV: page, type, note, the marked text, author, date and position, for every comment in the file (opens correctly in Excel, Arabic included)
- Comments are saved as real PDF annotations, so they appear in other apps' comment panels
- Set your name once, and it's used for every comment you add

**Find**
- Ctrl+F searches the PDF's text and recognized (OCR) text, with next/previous and highlighted matches

**Add to pages**
- Add text (3 font families, bold or italic, size, color, rotation)
- Pen and highlighter pen (freehand)
- Highlight area, rectangle, ellipse, line, arrow
- White-out (cover content, then type over it)
- Place images, and draw or upload a signature (signatures can be remembered on the device)
- Crop any image, including pictures that were already in the PDF (double-click an image, or use Crop in the side panel)
- Select, move, resize, duplicate and delete any item; double-click text to edit it
- Watermark and page numbers on every page (each can still be edited afterwards)
- Undo/redo for everything

**Organize**
- Open several PDFs and images at once to merge them, or drag more PDFs onto the window to add their pages (after the page you drop them on)
- Drag images onto a page to place them exactly where you drop them
- Drag thumbnails to reorder. The bar at the top of the pages panel rotates, duplicates, deletes or inserts a blank page for the current page, or for all selected pages (Shift/Ctrl-click thumbnails to select several)
- Extract selected pages to a new PDF, split into single pages, save pages as PNG
- Images (JPG, PNG, WebP…) become PDF pages
- Password-protected PDFs open after the user enters the password

**Other**
- Edits are written into the PDF itself, so they show up in any PDF reader
- Works on rotated pages and pages with unusual crop boxes
- Paste an image from the clipboard onto the current page
- Fold the pages panel and the side panel away (buttons in the top bar, or `[` and `]`) to give the page more room

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V / E / T / N | Select text and items / Edit PDF text & images / Add text / Sticky note |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy selected text or item, cut an item, paste (items, images, or text as a new text box) |
| Ctrl+A | Select all text on the current page |
| Ctrl+F | Find |
| [ / ] | Hide or show the pages panel / the side panel (more room for the page) |
| Page Up / Page Down, Home / End | Previous / next page, first / last page |
| P / H / M | Pen / Highlighter / Highlight area |
| R / O / L / A | Rectangle / Ellipse / Line / Arrow |
| W / I / S | White-out / Image / Signature |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+S | Save PDF |
| Ctrl+O | Open file |
| Ctrl + / Ctrl − / Ctrl 0 | Zoom in / out / 100% (Ctrl + mouse wheel also zooms) |
| Delete | Delete selected item |
| Arrow keys (Shift = ×10) | Nudge selected item |
| Ctrl+D | Duplicate selected item |
| Enter, or click selected text again | Edit selected text |
| Esc | Deselect, then back to Select tool |
| Enter / Esc while cropping | Apply / cancel the crop |

## Running it

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev        # development server at http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build locally
```

## Publishing it online for free

The build output in `dist/` is a static site, so any free static host works:

- **GitHub Pages:** push this folder to a GitHub repository, then go to Settings → Pages → Source and choose "GitHub Actions". The included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push to `main`. For this repository the address will be https://mohamed-badr-saad.github.io/PDF_Editor/
- **Netlify / Cloudflare Pages / Vercel:** connect the repository, use build command `npm run build` and output folder `dist`.

## Phone and tablet app (PWA)

Once the site is online over HTTPS (GitHub Pages does this), it installs like an app:

- **Android (Chrome, Edge, Samsung Internet):** tap "Install PageCraft" at the bottom of the start screen or in the Document menu (or the browser's "Install app" / "Add to Home screen").
- **iPhone / iPad (Safari):** tap Share, then "Add to Home Screen". The start screen shows this hint on iOS.
- **Windows / Mac (Chrome, Edge):** the same Install button, or the install icon in the address bar.

The installed app opens in its own window and works offline; the OCR engine is stored the first time OCR is used.

On phones the layout adapts: a compact top bar that always shows Save, the pages panel and the side panel slide in as drawers (buttons at the left and right of the top bar), swipe to scroll, pinch to zoom, and drawing tools take the finger for drawing.

## Desktop app (Windows, Mac, Linux)

The `desktop/` folder wraps the same app with [Electron](https://www.electronjs.org) into a program that runs fully offline, with no browser needed. It can be set as the app that opens PDF files ("Open with PageCraft"), and Save asks where to save the file.

**Easiest: let GitHub build it.** Push the project, then GitHub → Actions → "Build desktop app" → Run workflow. When it finishes, download the files from the run's Artifacts. Pushing a version tag (`git tag v0.5.0` then `git push --tags`) also attaches them to a GitHub Release that anyone can download. The workflow is in `.github/workflows/desktop.yml`.

**On your own computer:**

```bash
npm run desktop       # build and open the desktop app
npm run desktop:win   # build the Windows installer and portable .exe into desktop/release/
```

Each operating system builds its own files most reliably (Windows builds the `.exe`, a Mac builds the `.dmg`, Linux the `.AppImage`/`.deb`), which is why the GitHub workflow uses one machine of each.

Windows outputs:
- `PageCraft-Setup-<version>.exe`: installer with Start-menu shortcut, uninstaller and the "Open with" entry for PDFs
- `PageCraft-<version>-portable.exe`: a single file that runs without installing (handy on a USB stick)

The builds are not code-signed (a certificate costs money), so Windows SmartScreen may say "Windows protected your PC" the first time: click "More info", then "Run anyway". On a Mac, right-click the app and choose Open the first time.

## How it works

| Part | Library | Role |
| --- | --- | --- |
| UI | React 19 + TypeScript, Vite | App shell, tools, panels |
| State | Zustand | Document model and undo/redo history |
| Rendering | pdf.js (Mozilla) | Draws pages to canvas |
| Saving | pdf-lib | Copies the original pages and draws the edits into them |
| OCR | tesseract.js | Text recognition in a web worker (English and Arabic data bundled) |
| Arabic text | @pdf-lib/fontkit + Noto Sans Arabic | Letter joining when saving; `src/lib/bidi.ts` orders mixed Arabic/English lines |
| Offline | vite-plugin-pwa (Workbox) | Service worker and install manifest |

Key files:

- `src/lib/types.ts`: the data model. Annotations are stored in PDF points relative to the page.
- `src/lib/exportPdf.ts`: turns the document model into a real PDF.
- `src/lib/ocr/`: OCR with Tesseract (WebAssembly) and the invisible, searchable text layer.
- `src/lib/textLayout.ts`, `comments.ts`, `pdfAnnots.ts`: text selection and Find, the comment list and CSV export, saving comments as PDF annotations.
- `src/lib/content/`: the content editing engine. `tokenizer.ts` parses page content streams, `fonts.ts` reads font widths and character maps, `interpret.ts` finds where every character and image is drawn, `page.ts` groups characters into editable lines, and `rewrite.ts` removes characters by replacing them with equal spacing, so nothing else on the line moves.
- `src/components/PageView.tsx`: page rendering and all mouse interaction.
- `src/state/store.ts`: state and history.

## Known limitations / roadmap

- **Editing works line by line.** Text doesn't re-wrap across lines like a word processor yet (paragraph reflow is the next step for the Edit tool).
- **OCR accuracy** depends on scan quality. Arabic recognition is less accurate than English (occasional wrong letters).
- Copying Arabic out of a saved PDF in some readers can change a few letters, because joined letter shapes map back to text imperfectly; what's printed on the page is correct.
- Text and images inside "form XObjects" (used by some design tools and stamps) aren't editable yet; most PDFs from Word, Google Docs, LibreOffice and browsers draw directly on the page and work.
- Fonts in PDFs are usually *subsets* (only the letters used). Typing a letter the file never used switches that line to a similar standard font.
- Scripts other than Latin and Arabic (e.g. Chinese) and emoji in added text are replaced with "?" when saving.
- **White-out is visual only**: use the Edit tool to truly delete text. A dedicated redaction tool (areas, search-and-redact) is planned.
- **Fillable form fields** cannot be filled in directly yet (use the Text tool on top of them). Interactive fields in the original file may lose their interactivity when saved.
- Encrypted PDFs that pdf-lib can't read are saved with those pages as images.
- On phones the properties panel and thumbnails are hidden; a mobile layout is planned.
- Comments: replies to comments, and editing comments that came from other apps (they're listed and exported, but read-only).
- Other planned features: compression, compare PDFs, a native desktop build.
