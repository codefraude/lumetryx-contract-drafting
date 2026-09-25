/**
 * A supply agreement that uses the Word features the other fixtures
 * leave out: a logo image in the header, a table of contents, a
 * footnote, a reviewer's comment, tracked changes and a text box holding
 * a placeholder. It checks that filling and the editor keep them.
 */
import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  InsertedTextRun,
  Paragraph,
  Table,
  TableOfContents,
  TableRow,
  Textbox,
  TextRun,
  WidthType,
} from "docx";
import { bullets, cell, clause, footer, legalNumbering, styles } from "./parts";

/** 60 × 20 px, three bands (navy, teal, grey). */
const LOGO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADwAAAAUCAIAAABeYcl+AAAAOElEQVR42mOQt4onG/GX5ZGNplEAGEYdPeroUUePOnrU0aOOHnX0qKNHHT3q6FFHjzp61NG0cDQAZ9xanMQqrK8AAAAASUVORK5CYII=",
  "base64",
);
const REVIEWER = {
  author: "Reviewer",
  date: "2026-09-01T09:00:00Z",
};

export function supplyAgreement(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    footnotes: {
      1: {
        children: [
          new Paragraph(
            "Prices exclude VAT, charged at the rate in force on the invoice date.",
          ),
        ],
      },
    },
    comments: {
      children: [
        {
          id: 0,
          author: REVIEWER.author,
          initials: "RV",
          date: new Date(REVIEWER.date),
          children: [
            new Paragraph("Confirm the delivery terms with logistics."),
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new ImageRun({
                    type: "png",
                    data: LOGO,
                    transformation: {
                      width: 90,
                      height: 30,
                    },
                    altText: {
                      name: "Logo",
                      title: "Logo",
                      description: "Supplier logo",
                    },
                  }),
                  new TextRun({
                    text: "  Supply Agreement — Ref: [REFERENCE NUMBER]",
                    size: 18,
                    color: "555555",
                  }),
                ],
              }),
            ],
          }),
        },
        footers: { default: footer() },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun("SUPPLY AGREEMENT")],
          }),
          // Cached entries, so Word shows the contents
          // without being asked to update fields.
          new TableOfContents("Contents", {
            hyperlink: true,
            headingStyleRange: "2-2",
            cachedEntries: [
              {
                title: "Terms",
                level: 2,
                page: 1,
              },
              {
                title: "Signatures",
                level: 2,
                page: 1,
              },
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "This Agreement is made on {{effective_date}} between {{supplier_name}} (the “Supplier”) and [BUYER NAME] (the “Buyer”).",
              ),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Terms")],
          }),
          clause("Supply", 0),
          clause(
            [
              new TextRun(
                "The Supplier shall deliver {{product_description}} to the Buyer",
              ),
              new InsertedTextRun({
                text: " within 14 days of each order",
                id: 1,
                ...REVIEWER,
              }),
              new DeletedTextRun({
                text: " as soon as practicable",
                id: 2,
                ...REVIEWER,
              }),
              new TextRun("."),
            ],
            1,
          ),
          clause("Price", 0),
          clause(
            [
              new TextRun("The unit price is {{unit_price}}"),
              new FootnoteReferenceRun(1),
              new TextRun(", payable within 30 days of invoice."),
            ],
            1,
          ),
          clause(
            [
              new CommentRangeStart(0),
              new TextRun("Risk in the goods passes to the Buyer on delivery."),
              new CommentRangeEnd(0),
              new TextRun({ children: [new CommentReference(0)] }),
            ],
            1,
          ),
          new Textbox({
            alignment: AlignmentType.CENTER,
            style: {
              width: "320pt",
              height: "48pt",
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Key contact: {{supplier_contact}}",
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Signatures")],
          }),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [cell("Supplier", true), cell("Buyer", true)],
              }),
              new TableRow({
                children: [cell("{{supplier_name}}"), cell("[BUYER NAME]")],
              }),
              new TableRow({
                children: [
                  cell("Signed by: ________________"),
                  cell("Signed by: ________________"),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
}
