import { DOCX_LIMITS, DocxValidationError } from "./package";

/** Paragraph-level view of a Word package: what the rest of the server works with instead of XML. */

export type BlockKind = "heading" | "paragraph" | "listItem" | "tableCell";
export type PartKind = "body" | "header" | "footer";

export interface RunSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** A Word content control that still shows its placeholder text (e.g. “Votre nom”), located in the paragraph text. */
export interface PlaceholderSpan {
  start: number;
  end: number;
  /** Controls bound to the same data are kept identical by Word; they share this key. */
  binding: string | null;
  /** The control's title (alias) or tag, when it has one. */
  title: string | null;
}

export interface Block {
  /** Stable anchor: `${part}#${paragraphOrdinal}`. */
  id: string;
  part: string;
  partKind: PartKind;
  ordinal: number;
  kind: BlockKind;
  styleId: string | null;
  numbering: { numId: string; ilvl: number } | null;
  table: { table: number; row: number; col: number } | null;
  text: string;
  /** Word's w14:paraId. The editor keeps it through edits and exports, so it identifies a paragraph across revisions. */
  paraId: string | null;
  placeholders?: PlaceholderSpan[];
}

export interface RenderedBlock extends Block {
  runs: RunSpan[];
  numberLabel: string | null;
  headingLevel: number | null;
}

export function assertIndexable(blocks: Block[]): void {
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (blocks.length > DOCX_LIMITS.maxBlocks || chars > DOCX_LIMITS.maxIndexedChars) {
    throw new DocxValidationError("too_complex", `This template is larger than the supported size (${DOCX_LIMITS.maxBlocks} paragraphs / ${DOCX_LIMITS.maxIndexedChars.toLocaleString("en")} characters).`);
  }
}
