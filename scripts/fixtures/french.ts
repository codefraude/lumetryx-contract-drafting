import {
  AlignmentType,
  Document,
  Header,
  HeadingLevel,
  Paragraph,
  Table,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  bullets,
  cell,
  clause,
  footer,
  header,
  legalNumbering,
  pair,
  para,
  styles,
} from "./parts";

export function contratPrestation(): Document {
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
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "Contrat de prestation de services — Réf. : [RÉFÉRENCE DU DOSSIER]",
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
            children: [new TextRun("CONTRAT DE PRESTATION DE SERVICES")],
          }),
          para([
            new TextRun("Le présent contrat est conclu le "),
            new TextRun({
              text: "{{date_de_",
              bold: true,
            }),
            new TextRun({
              text: "signature}}",
              bold: true,
              italics: true,
            }),
            new TextRun(
              " entre {{nom_du_prestataire}}, société immatriculée sous le numéro [NUMÉRO D’IMMATRICULATION], dont le siège est situé [adresse du prestataire] (le « Prestataire »), et [NOM DU CLIENT], demeurant ________________ (le « Client »).",
            ),
          ]),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Conditions")],
          }),
          clause("Objet", 0),
          clause(
            "Le Prestataire fournit au Client les prestations suivantes : {{description_des_prestations}}.",
            1,
          ),
          clause("Les prestations sont exécutées avec soin et diligence.", 2),
          clause("Durée", 0),
          clause(
            "Le contrat prend effet le [date de début] pour une durée de [DURÉE] mois.",
            1,
          ),
          clause("Prix et paiement", 0),
          clause(
            "Le prix total s’élève à {{montant_total}}, payable selon l’échéancier ci-dessous.",
            1,
          ),
          clause(
            "Tout retard de paiement porte intérêt au taux de [TAUX D’INTÉRÊT] l’an.",
            2,
          ),
          new Paragraph({
            children: [
              new TextRun({
                text: "Échéancier de paiement",
                bold: true,
              }),
            ],
          }),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [cell("Échéance", true), cell("Montant", true)],
              }),
              new TableRow({
                children: [cell("À la signature"), cell("{{acompte}}")],
              }),
              new TableRow({
                children: [cell("À la livraison"), cell("{{solde}}")],
              }),
            ],
          }),
          clause("Droit applicable", 0),
          clause(
            "Le présent contrat est régi par le droit {{droit_applicable}}.",
            1,
          ),
          para(
            "Fait en deux exemplaires. Signé par le Prestataire : ________________    Signé par le Client : ________________",
          ),
        ],
      },
    ],
  });
}

export function bilingualLease(): Document {
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
        headers: { default: header("Residential Lease / Bail d’habitation") },
        footers: { default: footer() },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun("RESIDENTIAL LEASE — BAIL D’HABITATION")],
          }),
          ...pair(
            [
              new TextRun(
                "This Lease is made between [LANDLORD NAME] (the “Landlord”) and ",
              ),
              new TextRun({
                text: "{{tenant_name}}",
                bold: true,
              }),
              new TextRun(" (the “Tenant”)."),
            ],
            [
              new TextRun({
                text: "Le présent bail est conclu entre [NOM DU BAILLEUR] (le « Bailleur ») et ",
                italics: true,
              }),
              new TextRun({
                text: "{{nom_du_locataire}}",
                bold: true,
                italics: true,
              }),
              new TextRun({
                text: " (le « Locataire »).",
                italics: true,
              }),
            ],
          ),
          ...pair("Premises", "Locaux", 0),
          ...pair(
            "The Landlord lets to the Tenant the property situated at {{property_address}}.",
            "Le Bailleur donne à bail au Locataire le bien situé {{adresse_du_bien}}.",
            1,
          ),
          ...pair("Term", "Durée", 0),
          ...pair(
            "The lease commences on {{start_date}} for a term of [NUMBER OF MONTHS] months.",
            "Le bail prend effet le {{date_de_debut}} pour une durée de [NOMBRE DE MOIS] mois.",
            1,
          ),
          ...pair("Rent", "Loyer", 0),
          ...pair(
            "The monthly rent is {{monthly_rent}}, payable in advance.",
            "Le loyer mensuel est de {{loyer_mensuel}}, payable d’avance.",
            1,
          ),
          ...pair(
            "Clause 3 applies to every renewal.",
            "L’article 3 s’applique à chaque renouvellement.",
            1,
          ),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [
                  cell("Item / Poste", true),
                  cell("Amount / Montant", true),
                ],
              }),
              new TableRow({
                children: [
                  cell("Monthly rent / Loyer mensuel"),
                  cell("{{monthly_rent}}"),
                ],
              }),
              new TableRow({
                children: [
                  cell("Deposit / Dépôt de garantie"),
                  cell("[DEPOSIT]"),
                ],
              }),
            ],
          }),
          para(
            "Signed by the Tenant / Signé par le Locataire : ________________",
          ),
        ],
      },
    ],
  });
}

export function bilingualEmployment(): Document {
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
        headers: {
          default: header("Employment Contract / Contrat de travail"),
        },
        footers: { default: footer() },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun("EMPLOYMENT CONTRACT — CONTRAT DE TRAVAIL")],
          }),
          ...pair(
            "This contract is made between {{employer_name}} (the “Employer”) and [EMPLOYEE NAME] (the “Employee”).",
            "Le présent contrat est conclu entre {{nom_de_l_employeur}} (l’« Employeur ») et [NOM DU SALARIÉ] (le « Salarié »).",
          ),
          ...pair("Position", "Poste", 0),
          ...pair(
            "The Employee is employed as [JOB TITLE] from {{start_date}}.",
            "Le Salarié est engagé en qualité de [INTITULÉ DU POSTE] à compter du {{date_d_entree}}.",
            1,
          ),
          ...pair("Remuneration", "Rémunération", 0),
          ...pair(
            "The Employee receives the remuneration set out below, subject to clause 4.",
            "Le Salarié perçoit la rémunération ci-dessous, sous réserve de l’article 4.",
            1,
          ),
          new Table({
            width: {
              size: 100,
              type: WidthType.PERCENTAGE,
            },
            rows: [
              new TableRow({
                children: [
                  cell("Element / Élément", true),
                  cell("Amount / Montant", true),
                ],
              }),
              new TableRow({
                children: [
                  cell("Annual salary / Salaire annuel"),
                  cell("{{annual_salary}}"),
                ],
              }),
            ],
          }),
          para("[[IF employee_is_senior]]"),
          ...pair("Non-competition", "Non-concurrence", 0),
          ...pair(
            "For [NON-COMPETE PERIOD] after leaving, the Employee shall not work for a competitor within {{restricted_area}}.",
            "Pendant [DURÉE DE NON-CONCURRENCE] après son départ, le Salarié s’interdit de travailler pour un concurrent dans {{zone_geographique}}.",
            1,
          ),
          ...pair(
            "In return, the Employer pays a monthly indemnity of [NON-COMPETE INDEMNITY].",
            "En contrepartie, l’Employeur verse une indemnité mensuelle de [INDEMNITÉ DE NON-CONCURRENCE].",
            2,
          ),
          para("[[END IF]]"),
          ...pair("Termination", "Rupture", 0),
          ...pair(
            "Either party may end this contract with [NOTICE PERIOD] notice. Clause 3 survives termination.",
            "Chaque partie peut rompre le contrat moyennant un préavis de [PRÉAVIS]. L’article 3 survit à la rupture.",
            1,
          ),
          para(
            "Signed by the Employee / Signé par le Salarié : ________________",
          ),
        ],
      },
    ],
  });
}
