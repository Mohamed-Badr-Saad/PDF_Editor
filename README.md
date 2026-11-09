# PageCraft PDF Editor

A free PDF editor that runs entirely in the browser. Files are never uploaded; all processing happens on the user's device. After the first visit it also works offline, and it can be installed like a desktop app (PWA).

## Features (v0.3)

**Edit the PDF's own content** (Edit tool, key E)
- Click any line of text in the PDF to retype it. The old text is removed from the file itself (not covered up), so it's gone when the PDF is copied, searched or opened elsewhere
- New text uses the document's own embedded font whenever that font contains the letters you typed; otherwise a similar standard font is used and the panel says so
- Keeps the original size, color, position, rotation and spacing; the rest of the line slides along when the text gets longer or shorter
- Clear a line to delete it
- Click any picture in the PDF to move, resize, replace or delete it. Moved pictures keep their original quality (they're not re-compressed)
- Everything is undoable and previewed exactly as it will be saved

**Scanned documents (OCR)**
- Document → Recognize text (OCR): reads scanned pages and photos in English, Arabic, or both. Runs on the device; the reading engine downloads once (about 8 MB) and then works offline
- The saved PDF gets an invisible text layer, so it's searchable and its text can be selected and copied in any reader
- Recognized lines can be edited with the Edit tool: the new text is drawn over the scan on a patch of the paper's own color
- Copy the recognized text or save it as a .txt file

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
- Open several PDFs and images at once to merge them
- Drag thumbnails to reorder; rotate, duplicate, delete, insert blank pages
- Extract selected pages to a new PDF, split into single pages, save pages as PNG
- Images (JPG, PNG, WebP…) become PDF pages
- Password-protected PDFs open after the user enters the password

**Other**
- Edits are written into the PDF itself, so they show up in any PDF reader
- Works on rotated pages and pages with unusual crop boxes
- Paste an image from the clipboard onto the current page
- Installable app with offline support and "Open with" for PDF files

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V / E / T / N | Select text and items / Edit PDF text & images / Add text / Sticky note |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy selected text or item, cut an item, paste (items, images, or text as a new text box) |
| Ctrl+A | Select all text on the current page |
| Ctrl+F | Find |
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

- **GitHub Pages:** push this folder to a GitHub repository, then go to Settings → Pages → Source and choose "GitHub Actions". The included workflow (`.github/workflows/deploy.yml`) builds and publishes on every push to `main`.
- **Netlify / Cloudflare Pages / Vercel:** connect the repository, use build command `npm run build` and output folder `dist`.

## Offline / desktop version

The app is a Progressive Web App. After visiting the site once in Chrome or Edge, users can click the install icon in the address bar to get a desktop app with its own window and Start-menu entry. It then works fully offline. A native installer (`.exe`) can be added later with [Tauri](https://tauri.app), wrapping this same code.

## How it works

| Part | Library | Role |
| --- | --- | --- |
| UI | React 19 + TypeScript, Vite | App shell, tools, panels |
| State | Zustand | Document model and undo/redo history |
| Rendering | pdf.js (Mozilla) | Draws pages to canvas |
| Saving | pdf-lib | Copies the original pages and draws the edits into them |
| OCR | tesseract.js | Text recognition in a web worker (English and Arabic data bundled) |
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
- **OCR accuracy** depends on scan quality. Arabic recognition is noticeably less accurate than English. Editing recognized Arabic lines isn't supported yet (they're searchable and copyable).
- Text and images inside "form XObjects" (used by some design tools and stamps) aren't editable yet; most PDFs from Word, Google Docs, LibreOffice and browsers draw directly on the page and work.
- Fonts in PDFs are usually *subsets* (only the letters used). Typing a letter the file never used switches that line to a similar standard font.
- **Arabic, other non-Latin scripts and emoji** in added text are replaced with "?" when saving, because the 14 built-in PDF fonts are Latin-only. (Edited text in the original font works for any script the file's font already contains.) Next step: bundle a Unicode font (for example Noto Sans Arabic) with right-to-left shaping.
- **White-out is visual only**: use the Edit tool to truly delete text. A dedicated redaction tool (areas, search-and-redact) is planned.
- **Fillable form fields** cannot be filled in directly yet (use the Text tool on top of them). Interactive fields in the original file may lose their interactivity when saved.
- Encrypted PDFs that pdf-lib can't read are saved with those pages as images.
- On phones the properties panel and thumbnails are hidden; a mobile layout is planned.
- Comments: replies to comments, and editing comments that came from other apps (they're listed and exported, but read-only).
- Other planned features: compression, compare PDFs, a native desktop build.
