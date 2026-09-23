/**
 * SYNTHETIC fixtures. These are NOT the employer's sample templates; they
 * exist so the full flow can be tested before those templates arrive.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const legalNumbering = {
  reference: "legal",
  levels: [
    { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 432, hanging: 432 } } } },
    { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1008, hanging: 576 } } } },
    { level: 2, format: LevelFormat.DECIMAL, text: "%1.%2.%3.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1728, hanging: 720 } } } },
  ],
};

const bullets = {
  reference: "bullets",
  levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
};

const clause = (text: string | TextRun[], level: 0 | 1 | 2) =>
  new Paragraph({
    numbering: { reference: "legal", level },
    spacing: { after: 120 },
    children: typeof text === "string" ? [new TextRun(text)] : text,
  });

const bullet = (text: string) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(text)] });

const cell = (children: TextRun[] | string, bold = false) =>
  new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: typeof children === "string" ? [new TextRun({ text: children, bold })] : children })],
  });

const header = (title: string) =>
  new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${title} — Ref: [REFERENCE NUMBER]`, size: 18, color: "555555" })] })] });

const footer = () =>
  new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ["SYNTHETIC TEST FIXTURE · Page ", PageNumber.CURRENT], size: 16, color: "777777" })],
      }),
    ],
  });

const styles = {
  default: { document: { run: { font: "Georgia", size: 22 } } },
  paragraphStyles: [
    { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Georgia", size: 32, bold: true, color: "1F3A5F" }, paragraph: { spacing: { before: 240, after: 160 } } },
    { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: "Georgia", size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 120 } } },
  ],
};

function nda(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1260, right: 1260 } } },
        headers: { default: header("Mutual Non-Disclosure Agreement") },
        footers: { default: footer() },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun("MUTUAL NON-DISCLOSURE AGREEMENT")] }),
          new Paragraph({
            children: [
              new TextRun("This Agreement is made on {{effective_date}} between "),
              // Placeholder deliberately split across runs with mixed formatting.
              new TextRun({ text: "{{disclosing_", bold: true }),
              new TextRun({ text: "party_name}}", bold: true, italics: true }),
              new TextRun(", a company registered under number [COMPANY NUMBER], and [RECEIVING PARTY NAME] of ________________ (together, the \u201cParties\u201d)."),
            ],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Terms")] }),
          clause("Definitions", 0),
          clause([new TextRun("\u201cConfidential Information\u201d means all information disclosed by either party, including "), new TextRun({ text: "trade secrets & know-how", underline: {} }), new TextRun(".")], 1),
          clause("Information already public is excluded.", 2),
          clause("Information independently developed is excluded.", 2),
          clause("Obligations", 0),
          clause("Each party shall keep Confidential Information secret for a period of [NUMBER] years from the date of this Agreement.", 1),
          clause("The Receiving Party may disclose Confidential Information to its employees on a need-to-know basis.", 1),
          clause("General", 0),
          clause("This Agreement is governed by the laws of {{governing_law}}.", 1),
          new Paragraph({ children: [new TextRun({ text: "Permitted purposes:", bold: true })] }),
          bullet("evaluating a potential business relationship;"),
          bullet("complying with applicable law."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Signatures")] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Disclosing Party", true), cell("Receiving Party", true)] }),
              new TableRow({ children: [cell("{{disclosing_party_name}}"), cell("[RECEIVING PARTY NAME]")] }),
              new TableRow({ children: [cell("Signed by: ________________"), cell("Signed by: ________________")] }),
            ],
          }),
        ],
      },
    ],
  });
}

function lease(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: { default: header("Residential Lease Agreement") },
        footers: { default: footer() },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun("RESIDENTIAL LEASE AGREEMENT")] }),
          new Paragraph({
            children: [
              new TextRun("This Lease is entered into between [LANDLORD NAME] (the \u201cLandlord\u201d) and "),
              new TextRun({ text: "{{tenant_name}}", bold: true }),
              new TextRun(", the Tenant, of [address]."),
            ],
          }),
          clause("Premises", 0),
          clause("The Landlord lets to the Tenant the property situated at {{property_address}} (the \u201cPremises\u201d).", 1),
          clause("Term", 0),
          clause("The lease starts on {{start_date}} and ends on ____________.", 1),
          clause("Rent", 0),
          clause("The Tenant shall pay a monthly rent of {{monthly_rent}}, payable in advance on the first day of each month.", 1),
          clause("Late payments attract interest at [INTEREST RATE] per annum.", 2),
          clause("A security deposit of {{deposit_amount}} is payable on signature.", 1),
          clause("Use", 0),
          clause("The Premises shall be used only as a private residence.", 1),
          new Paragraph({ children: [new TextRun({ text: "The Tenant shall not:", italics: true })] }),
          bullet("sublet the Premises without written consent;"),
          bullet("keep animals without written consent."),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Schedule of payments")] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Item", true), cell("Amount", true)] }),
              new TableRow({ children: [cell("Monthly rent"), cell("{{monthly_rent}}")] }),
              new TableRow({ children: [cell("Deposit"), cell("{{deposit_amount}}")] }),
            ],
          }),
          new Paragraph({ spacing: { before: 240 }, children: [new TextRun("Signed by the Landlord: ________________    Signed by {{tenant_name}}: ________________")] }),
        ],
      },
    ],
  });
}

const para = (text: string | TextRun[], opts: { italic?: boolean } = {}) => new Paragraph({ spacing: { after: 120 }, children: typeof text === "string" ? [new TextRun({ text, italics: opts.italic })] : text });
/** Bilingual pair: the English paragraph, then its French version in italics (a common layout for bilingual contracts). */
const pair = (en: string | TextRun[], fr: string | TextRun[], level?: 0 | 1 | 2) =>
  level === undefined ? [para(en), para(typeof fr === "string" ? [new TextRun({ text: fr, italics: true })] : fr)] : [clause(en, level), para(typeof fr === "string" ? [new TextRun({ text: fr, italics: true })] : fr)];

/** French-only services agreement: accented placeholders, a placeholder split across runs, underscore blanks, a table and legal numbering. */
function contratPrestation(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Contrat de prestation de services — Réf. : [RÉFÉRENCE DU DOSSIER]", size: 18, color: "555555" })] })] }) },
        footers: { default: footer() },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun("CONTRAT DE PRESTATION DE SERVICES")] }),
          para([
            new TextRun("Le présent contrat est conclu le "),
            // Accented placeholder deliberately split across differently formatted runs.
            new TextRun({ text: "{{date_de_", bold: true }),
            new TextRun({ text: "signature}}", bold: true, italics: true }),
            new TextRun(" entre {{nom_du_prestataire}}, société immatriculée sous le numéro [NUMÉRO D’IMMATRICULATION], dont le siège est situé [adresse du prestataire] (le « Prestataire »), et [NOM DU CLIENT], demeurant ________________ (le « Client »)."),
          ]),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Conditions")] }),
          clause("Objet", 0),
          clause("Le Prestataire fournit au Client les prestations suivantes : {{description_des_prestations}}.", 1),
          clause("Les prestations sont exécutées avec soin et diligence.", 2),
          clause("Durée", 0),
          clause("Le contrat prend effet le [date de début] pour une durée de [DURÉE] mois.", 1),
          clause("Prix et paiement", 0),
          clause("Le prix total s’élève à {{montant_total}}, payable selon l’échéancier ci-dessous.", 1),
          clause("Tout retard de paiement porte intérêt au taux de [TAUX D’INTÉRÊT] l’an.", 2),
          new Paragraph({ children: [new TextRun({ text: "Échéancier de paiement", bold: true })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Échéance", true), cell("Montant", true)] }),
              new TableRow({ children: [cell("À la signature"), cell("{{acompte}}")] }),
              new TableRow({ children: [cell("À la livraison"), cell("{{solde}}")] }),
            ],
          }),
          clause("Droit applicable", 0),
          clause("Le présent contrat est régi par le droit {{droit_applicable}}.", 1),
          para("Fait en deux exemplaires. Signé par le Prestataire : ________________    Signé par le Client : ________________"),
        ],
      },
    ],
  });
}

/** Bilingual (English/French) lease: the same tenant, date and rent appear in both languages. */
function bilingualLease(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: { default: header("Residential Lease / Bail d’habitation") },
        footers: { default: footer() },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun("RESIDENTIAL LEASE — BAIL D’HABITATION")] }),
          ...pair(
            [new TextRun("This Lease is made between [LANDLORD NAME] (the “Landlord”) and "), new TextRun({ text: "{{tenant_name}}", bold: true }), new TextRun(" (the “Tenant”).")],
            [new TextRun({ text: "Le présent bail est conclu entre [NOM DU BAILLEUR] (le « Bailleur ») et ", italics: true }), new TextRun({ text: "{{nom_du_locataire}}", bold: true, italics: true }), new TextRun({ text: " (le « Locataire »).", italics: true })],
          ),
          ...pair("Premises", "Locaux", 0),
          ...pair("The Landlord lets to the Tenant the property situated at {{property_address}}.", "Le Bailleur donne à bail au Locataire le bien situé {{adresse_du_bien}}.", 1),
          ...pair("Term", "Durée", 0),
          ...pair("The lease commences on {{start_date}} for a term of [NUMBER OF MONTHS] months.", "Le bail prend effet le {{date_de_debut}} pour une durée de [NOMBRE DE MOIS] mois.", 1),
          ...pair("Rent", "Loyer", 0),
          ...pair("The monthly rent is {{monthly_rent}}, payable in advance.", "Le loyer mensuel est de {{loyer_mensuel}}, payable d’avance.", 1),
          ...pair("Clause 3 applies to every renewal.", "L’article 3 s’applique à chaque renouvellement.", 1),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Item / Poste", true), cell("Amount / Montant", true)] }),
              new TableRow({ children: [cell("Monthly rent / Loyer mensuel"), cell("{{monthly_rent}}")] }),
              new TableRow({ children: [cell("Deposit / Dépôt de garantie"), cell("[DEPOSIT]")] }),
            ],
          }),
          para("Signed by the Tenant / Signé par le Locataire : ________________"),
        ],
      },
    ],
  });
}

/** Bilingual employment contract with a conditional non-compete clause marked with [[IF …]] / [[END IF]]. */
function bilingualEmployment(): Document {
  return new Document({
    creator: "Lumetryx synthetic fixture",
    styles,
    numbering: { config: [legalNumbering, bullets] },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: { default: header("Employment Contract / Contrat de travail") },
        footers: { default: footer() },
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, children: [new TextRun("EMPLOYMENT CONTRACT — CONTRAT DE TRAVAIL")] }),
          ...pair("This contract is made between {{employer_name}} (the “Employer”) and [EMPLOYEE NAME] (the “Employee”).", "Le présent contrat est conclu entre {{nom_de_l_employeur}} (l’« Employeur ») et [NOM DU SALARIÉ] (le « Salarié »)."),
          ...pair("Position", "Poste", 0),
          ...pair("The Employee is employed as [JOB TITLE] from {{start_date}}.", "Le Salarié est engagé en qualité de [INTITULÉ DU POSTE] à compter du {{date_d_entree}}.", 1),
          ...pair("Remuneration", "Rémunération", 0),
          ...pair("The Employee receives the remuneration set out below, subject to clause 4.", "Le Salarié perçoit la rémunération ci-dessous, sous réserve de l’article 4.", 1),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [cell("Element / Élément", true), cell("Amount / Montant", true)] }),
              new TableRow({ children: [cell("Annual salary / Salaire annuel"), cell("{{annual_salary}}")] }),
            ],
          }),
          para("[[IF employee_is_senior]]"),
          ...pair("Non-competition", "Non-concurrence", 0),
          ...pair("For [NON-COMPETE PERIOD] after leaving, the Employee shall not work for a competitor within {{restricted_area}}.", "Pendant [DURÉE DE NON-CONCURRENCE] après son départ, le Salarié s’interdit de travailler pour un concurrent dans {{zone_geographique}}.", 1),
          ...pair("In return, the Employer pays a monthly indemnity of [NON-COMPETE INDEMNITY].", "En contrepartie, l’Employeur verse une indemnité mensuelle de [INDEMNITÉ DE NON-CONCURRENCE].", 2),
          para("[[END IF]]"),
          ...pair("Termination", "Rupture", 0),
          ...pair("Either party may end this contract with [NOTICE PERIOD] notice. Clause 3 survives termination.", "Chaque partie peut rompre le contrat moyennant un préavis de [PRÉAVIS]. L’article 3 survit à la rupture.", 1),
          para("Signed by the Employee / Signé par le Salarié : ________________"),
        ],
      },
    ],
  });
}

mkdirSync("fixtures", { recursive: true });
mkdirSync("public/examples", { recursive: true });
for (const [name, doc] of [
  ["synthetic-mutual-nda", nda()],
  ["synthetic-residential-lease", lease()],
  ["synthetic-contrat-prestation-fr", contratPrestation()],
  ["synthetic-bilingual-lease", bilingualLease()],
  ["synthetic-bilingual-employment", bilingualEmployment()],
] as const) {
  const buf = await Packer.toBuffer(doc);
  writeFileSync(`fixtures/${name}.docx`, buf);
  writeFileSync(`public/examples/${name}.docx`, buf);
  console.log(`wrote fixtures/${name}.docx (${buf.length} bytes)`);
}
