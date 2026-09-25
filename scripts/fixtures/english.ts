/**
 * English templates: a mutual NDA and a residential lease
 * (placeholders split across runs, legal numbering, bullets, tables).
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Paragraph,
  Table,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  bullet,
  bullets,
  cell,
  clause,
  footer,
  header,
  legalNumbering,
  styles,
} from "./parts";

export function nda(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1260,
              right: 1260,
            },
          },
        },
        headers: { default: header("Mutual Non-Disclosure Agreement") },
        footers: { default: footer() },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun("MUTUAL NON-DISCLOSURE AGREEMENT")],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "This Agreement is made on {{effective_date}} between ",
              ),
              // Placeholder deliberately split
              // across runs with mixed formatting.
              new TextRun({
                text: "{{disclosing_",
                bold: true,
              }),
              new TextRun({
                text: "party_name}}",
                bold: true,
                italics: true,
              }),
              new TextRun(
                ", a company registered under number [COMPANY NUMBER], and [RECEIVING PARTY NAME] of ________________ (together, the \u201cParties\u201d).",
              ),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Terms")],
          }),
          clause("Definitions", 0),
          clause(
            [
              new TextRun(
                "\u201cConfidential Information\u201d means all information disclosed by either party, including ",
              ),
              new TextRun({
                text: "trade secrets & know-how",
                underline: {},
              }),
              new TextRun("."),
            ],
            1,
          ),
          clause("Information already public is excluded.", 2),
          clause("Information independently developed is excluded.", 2),
          clause("Obligations", 0),
          clause(
            "Each party shall keep Confidential Information secret for a period of [NUMBER] years from the date of this Agreement.",
            1,
          ),
          clause(
            "The Receiving Party may disclose Confidential Information to its employees on a need-to-know basis.",
            1,
          ),
          clause("General", 0),
          clause(
            "This Agreement is governed by the laws of {{governing_law}}.",
            1,
          ),
          new Paragraph({
            children: [
              new TextRun({
                text: "Permitted purposes:",
                bold: true,
              }),
            ],
          }),
          bullet("evaluating a potential business relationship;"),
          bullet("complying with applicable law."),
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
                children: [
                  cell("Disclosing Party", true),
                  cell("Receiving Party", true),
                ],
              }),
              new TableRow({
                children: [
                  cell("{{disclosing_party_name}}"),
                  cell("[RECEIVING PARTY NAME]"),
                ],
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

export function lease(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
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
        headers: { default: header("Residential Lease Agreement") },
        footers: { default: footer() },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun("RESIDENTIAL LEASE AGREEMENT")],
          }),
          new Paragraph({
            children: [
              new TextRun(
                "This Lease is entered into between [LANDLORD NAME] (the \u201cLandlord\u201d) and ",
              ),
              new TextRun({
                text: "{{tenant_name}}",
                bold: true,
              }),
              new TextRun(", the Tenant, of [address]."),
            ],
          }),
          clause("Premises", 0),
          clause(
            "The Landlord lets to the Tenant the property situated at {{property_address}} (the \u201cPremises\u201d).",
            1,
          ),
          clause("Term", 0),
          clause(
            "The lease starts on {{start_date}} and ends on ____________.",
            1,
          ),
          clause("Rent", 0),
          clause(
            "The Tenant shall pay a monthly rent of {{monthly_rent}}, payable in advance on the first day of each month.",
            1,
          ),
          clause(
            "Late payments attract interest at [INTEREST RATE] per annum.",
            2,
          ),
          clause(
            "A security deposit of {{deposit_amount}} is payable on signature.",
            1,
          ),
          clause("Use", 0),
          clause("The Premises shall be used only as a private residence.", 1),
          new Paragraph({
            children: [
              new TextRun({
                text: "The Tenant shall not:",
                italics: true,
              }),
            ],
          }),
          bullet("sublet the Premises without written consent;"),
          bullet("keep animals without written consent."),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Schedule of payments")],
          }),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [cell("Item", true), cell("Amount", true)],
              }),
              new TableRow({
                children: [cell("Monthly rent"), cell("{{monthly_rent}}")],
              }),
              new TableRow({
                children: [cell("Deposit"), cell("{{deposit_amount}}")],
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 240 },
            children: [
              new TextRun(
                "Signed by the Landlord: ________________    Signed by {{tenant_name}}: ________________",
              ),
            ],
          }),
        ],
      },
    ],
  });
}
