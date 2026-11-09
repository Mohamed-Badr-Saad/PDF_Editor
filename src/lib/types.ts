// Core data model.
//
// Coordinates: every annotation lives in the page's "base space": PDF points,
// origin at the top-left of the page as it looks with its *original* rotation,
// y pointing down. Extra rotation the user applies in the editor is stored on
// the page and applied on top, so annotations stay glued to page content.

export type Rotation = 0 | 90 | 180 | 270;

export interface SourceDoc {
  id: string;
  name: string;
  bytes: Uint8Array;
}

export interface PageItem {
  id: string;
  /** Source document id, or null for a blank page. */
  docId: string | null;
  /** Page index inside the source document. */
  srcIndex: number;
  /** Size in points in base space (original rotation applied). */
  width: number;
  height: number;
  /** Rotation added in the editor, clockwise. */
  rotation: Rotation;
}

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';

interface AnnBase {
  id: string;
  opacity: number;
}

/** Present when a text item was converted from the PDF's own text. */
export interface TextSource {
  fontRes: string;
  fontName: string;
  ascent: number;
  hScale: number;
  tc: number;
  tw: number;
  /** Characters the original font can print. */
  chars: string;
  /** Try to keep the document's own font (falls back if characters are missing). */
  useOriginal: boolean;
  originalText: string;
  /** Segment of the original page this text came from. */
  segId: string;
}

/** Present when an image was taken from the PDF's own content. */
export interface ImageSource {
  /** XObject resource name, drawn again losslessly when saving. */
  name?: string;
  inline: boolean;
  /** Unit square → base space (y up) at the original position. */
  matrixBase: number[];
  /** Box at the original position (base space, y down). */
  box0: { x: number; y: number; w: number; h: number };
}

// ---------- OCR ----------

export interface OcrWord {
  text: string;
  /** Baseline start in base space (y down). */
  x: number;
  y: number;
  /** Length along the reading direction, in points. */
  w: number;
}

export interface OcrLine {
  id: string;
  text: string;
  words: OcrWord[];
  /** Baseline start of the line in base space (y down). */
  x: number;
  y: number;
  /** Clockwise degrees in base space (text is upright as the page is shown). */
  angle: number;
  fontSize: number;
  /** Axis-aligned bounds in base space. */
  box: { x: number; y: number; w: number; h: number };
  /** Paper colour around the line and ink colour of the letters (sampled from the scan). */
  bg: string;
  fg: string;
  confidence: number;
  rtl: boolean;
}

export interface OcrPage {
  lang: string;
  lines: OcrLine[];
}

export interface TextAnn extends AnnBase {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
  /** Clockwise rotation in degrees around the top-left corner. */
  angle: number;
  source?: TextSource;
  /** Set when the text came from OCR of a scan: the recognised text, before editing. */
  ocrText?: string;
}

export interface InkAnn extends AnnBase {
  type: 'ink';
  points: number[]; // flat [x0, y0, x1, y1, ...]
  color: string;
  width: number;
  /** Highlighter strokes multiply onto the page. */
  highlighter: boolean;
}

export interface RectAnn extends AnnBase {
  type: 'rect' | 'ellipse' | 'highlight' | 'whiteout';
  x: number;
  y: number;
  w: number;
  h: number;
  stroke: string | null;
  fill: string | null;
  strokeWidth: number;
}

export interface LineAnn extends AnnBase {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

/** Visible part of an image, as fractions of the full picture. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageAnn extends AnnBase {
  type: 'image';
  /** Box of the visible (cropped) part. */
  x: number;
  y: number;
  w: number;
  h: number;
  imageId: string;
  source?: ImageSource;
  crop?: Crop;
}

interface CommentFields {
  author: string;
  /** ISO timestamps. */
  created: string;
  modified: string;
}

/** Sticky-note comment. Saved as a real PDF comment (Text annotation). */
export interface NoteAnn extends AnnBase, CommentFields {
  type: 'note';
  x: number;
  y: number;
  color: string;
  text: string;
}

export type MarkupKind = 'highlight' | 'underline' | 'strikeout';

/** Highlight / underline / strike-out on selected text, with an optional note. */
export interface MarkupAnn extends AnnBase, CommentFields {
  type: 'markup';
  kind: MarkupKind;
  /** One box per line of selected text (base space). */
  quads: { x: number; y: number; w: number; h: number }[];
  color: string;
  note: string;
  quotedText: string;
}

export type Annotation = TextAnn | InkAnn | RectAnn | LineAnn | ImageAnn | NoteAnn | MarkupAnn;

export interface StoredImage {
  id: string;
  /** PNG or JPEG bytes (other formats are converted to PNG on import). */
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  url: string; // object URL for display
  width: number;
  height: number;
}

export type Tool =
  | 'select'
  | 'text'
  | 'draw'
  | 'highlighter'
  | 'highlight'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'whiteout'
  | 'image'
  | 'signature'
  | 'edit'
  | 'note';

export interface ToolStyle {
  color: string;
  strokeWidth: number;
  fontSize: number;
  font: FontFamily;
  fill: string | null;
  opacity: number;
  highlightColor: string;
}
