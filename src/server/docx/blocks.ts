import { z } from "zod";
import { DOCX_LIMITS, DocxValidationError } from "./package";

export type BlockKind = "heading" | "paragraph" | "listItem" | "tableCell";
export type PartKind = "body" | "header" | "footer";

export interface RunSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface PlaceholderSpan {
  start: number;
  end: number;
  binding: string | null;
  title: string | null;
}

export interface NumberingRef {
  numId: string;
  ilvl: number;
}

export interface Block {
  id: string;
  part: string;
  partKind: PartKind;
  ordinal: number;
  kind: BlockKind;
  styleId: string | null;
  numbering: NumberingRef | null;
  table: {
    table: number;
    row: number;
    col: number;
  } | null;
  text: string;
  paraId: string | null;
  placeholders?: PlaceholderSpan[];
}

export interface RenderedBlock extends Block {
  runs: RunSpan[];
  numberLabel: string | null;
  headingLevel: number | null;
}

export const CachedBlocks: z.ZodType<Block[]> = z.array(
  z.object({
    id: z.string(),
    part: z.string(),
    partKind: z.enum(["body", "header", "footer"]),
    ordinal: z.number().int(),
    kind: z.enum(["heading", "paragraph", "listItem", "tableCell"]),
    styleId: z.string().nullable(),
    numbering: z
      .object({
        numId: z.string(),
        ilvl: z.number().int(),
      })
      .nullable(),
    table: z
      .object({
        table: z.number().int(),
        row: z.number().int(),
        col: z.number().int(),
      })
      .nullable(),
    text: z.string(),
    paraId: z.string().nullable(),
    placeholders: z
      .array(
        z.object({
          start: z.number().int(),
          end: z.number().int(),
          binding: z.string().nullable(),
          title: z.string().nullable(),
        }),
      )
      .optional(),
  }),
);

export function assertIndexable(blocks: Block[]): void {
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);

  if (
    blocks.length > DOCX_LIMITS.maxBlocks ||
    chars > DOCX_LIMITS.maxIndexedChars
  ) {
    throw new DocxValidationError(
      "too_complex",
      `This template is larger than the supported size (${DOCX_LIMITS.maxBlocks} paragraphs / ${DOCX_LIMITS.maxIndexedChars.toLocaleString("en")} characters).`,
    );
  }
}
