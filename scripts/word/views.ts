import { z } from "zod";

/** What scripts/word/inspect.ps1 reports about each document, as Microsoft Word sees it. Validated when read. */

const Flag = z.union([z.boolean(), z.literal("mixed")]);
const Format = z.object({ font: z.string(), size: z.number(), bold: Flag, italic: Flag, underline: Flag, color: z.number() });
export type Format = z.infer<typeof Format>;

export const Paragraph = z.object({
  text: z.string(),
  style: z.string(),
  outline: z.number(),
  /** The number Word computes for a list item ("3.1.", "•"), so live numbering, never typed text. */
  list: z.string(),
  listLevel: z.number(),
  listType: z.number(),
  align: z.number(),
  left: z.number(),
  first: z.number(),
  before: z.number(),
  after: z.number(),
  line: z.number(),
  font: z.string(),
  size: z.number(),
  bold: Flag,
  italic: Flag,
  underline: Flag,
  inTable: z.boolean(),
});
export type Paragraph = z.infer<typeof Paragraph>;

const Control = z.object({ title: z.string().nullable(), placeholder: z.boolean(), mapped: z.boolean(), text: z.string() });
const Story = z.object({ text: z.string(), fields: z.array(z.number()), images: z.number(), controls: z.array(Control) });
export type Story = z.infer<typeof Story>;
const Section = z.object({
  top: z.number(),
  bottom: z.number(),
  left: z.number(),
  right: z.number(),
  width: z.number(),
  height: z.number(),
  orientation: z.number(),
  header: Story,
  footer: Story,
});
const Probe = z.discriminatedUnion("found", [
  z.object({ text: z.string(), found: z.literal(true), story: z.number(), whole: Format, first: Format }),
  z.object({ text: z.string(), found: z.literal(false) }),
]);

export const View = z.object({
  pages: z.number(),
  paragraphs: z.array(Paragraph),
  sections: z.array(Section),
  tables: z.array(z.object({ rows: z.number(), cols: z.number(), borders: z.boolean(), cells: z.array(z.string()) })),
  shapes: z.array(z.object({ type: z.number(), text: z.string() })),
  body: Story,
  footnotes: z.array(z.string()),
  endnotes: z.array(z.string()),
  comments: z.array(z.object({ author: z.string(), text: z.string(), scope: z.string() })),
  revisions: z.array(z.object({ type: z.number(), text: z.string() })),
  tocs: z.number(),
  fonts: z.array(z.string()),
  probes: z.array(Probe).default([]),
});
export type View = z.infer<typeof View>;

export const Inspection = z.object({
  word: z.object({ version: z.string(), build: z.string() }),
  files: z.array(z.object({ file: z.string(), opened: z.boolean(), error: z.string().nullable(), view: View.nullable() })),
});

/** What tests/e2e/word-exports.spec.ts answered for each field of a fixture. */
export const Answers = z.object({
  fields: z.array(z.object({ label: z.string(), answer: z.string(), shown: z.string().nullable(), placeholders: z.array(z.string()) })),
});
export type Answers = z.infer<typeof Answers>;
