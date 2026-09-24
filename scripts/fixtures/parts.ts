/** Building blocks shared by the docx-library fixtures: numbering, clause and table helpers, header, footer and styles. */
import { AlignmentType, Footer, Header, LevelFormat, PageNumber, Paragraph, TableCell, TextRun, WidthType, type ParagraphChild } from "docx";

export const legalNumbering = {
  reference: "legal",
  levels: [
    { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 432, hanging: 432 } } } },
    { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1008, hanging: 576 } } } },
    { level: 2, format: LevelFormat.DECIMAL, text: "%1.%2.%3.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1728, hanging: 720 } } } },
  ],
};

export const bullets = {
  reference: "bullets",
  levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
};

export const clause = (text: string | ParagraphChild[], level: 0 | 1 | 2) =>
  new Paragraph({
    numbering: { reference: "legal", level },
    spacing: { after: 120 },
    children: typeof text === "string" ? [new TextRun(text)] : text,
  });

export const bullet = (text: string) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(text)] });

export const cell = (children: TextRun[] | string, bold = false) =>
  new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: typeof children === "string" ? [new TextRun({ text: children, bold })] : children })],
  });

export const header = (title: string) =>
  new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${title} — Ref: [REFERENCE NUMBER]`, size: 18, color: "555555" })] })] });

export const footer = () =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ["SYNTHETIC TEST FIXTURE · Page ", PageNumber.CURRENT], size: 16, color: "777777" })],
      }),
    ],
  });

export const styles = {
  default: { document: { run: { font: "Georgia", size: 22 } } },
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Georgia", size: 32, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 240, after: 160 } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: "Georgia", size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 120 } } },
  ],
};

export const para = (text: string | TextRun[], opts: { italic?: boolean } = {}) => new Paragraph({ spacing: { after: 120 }, children: typeof text === "string" ? [new TextRun({ text, italics: opts.italic })] : text });
/** Bilingual pair: the English paragraph, then its French version in italics (a common layout for bilingual contracts). */
export const pair = (en: string | TextRun[], fr: string | TextRun[], level?: 0 | 1 | 2) =>
  level === undefined ? [para(en), para(typeof fr === "string" ? [new TextRun({ text: fr, italics: true })] : fr)] : [clause(en, level), para(typeof fr === "string" ? [new TextRun({ text: fr, italics: true })] : fr)];
