import JSZip from "jszip";

// ---------- Word content controls ---------- The docx library cannot write
// text content controls, so this letter is written as WordprocessingML. It
// follows the shape of Word's own letter templates: every blank is a
// placeholder box, some boxes are bound to document properties (Word repeats
// their value), some are temporary, the header repeats two of them, the letter
// body is sample wording in boxes too, and one box shows Word's generic prompt.

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

const esc = (s: string) => {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const CORE = [
  "{6C3C8BC8-F283-45AE-878A-BAB7291924A1}",
  "xmlns:ns0='http://purl.org/dc/elements/1.1/' xmlns:ns1='http://schemas.openxmlformats.org/package/2006/metadata/core-properties' ",
] as const;

const bound = (xpath: string, store: readonly [string, string] = CORE) => {
  return {
    store: store[0],
    ns: store[1],
    xpath,
  };
};

const SENDER = bound("/ns1:coreProperties[1]/ns1:keywords[1]");
const RECIPIENT = bound("/ns1:coreProperties[1]/ns1:category[1]");
const LETTER_DATE = bound("/ns1:coreProperties[1]/ns0:subject[1]");
const INSURER = bound(
  "/ns0:properties[1]/documentManagement[1]/ns3:Item_x0020_Details[1]",
  [
    "{00000000-0000-0000-0000-000000000000}",
    "xmlns:ns0='http://schemas.microsoft.com/office/2006/metadata/properties' xmlns:ns3='40262f94-9f35-4ac3-9a90-690165a166b7' ",
  ],
);

interface Box {
  title: string;
  text: string;
  bind?: ReturnType<typeof bound>;
  temporary?: boolean;
  style?: string;
  gallery?: string;
}

let boxId = 100;

const run = (text: string, style?: string) => {
  return `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
};

const boxPr = (b: Box) => {
  return `<w:sdtPr><w:alias w:val="${esc(b.title)}"/><w:tag w:val="${esc(b.title)}"/><w:id w:val="${boxId++}"/>${b.gallery ? `<w:docPartObj><w:docPartGallery w:val="${b.gallery}"/><w:docPartUnique/></w:docPartObj>` : ""}${b.temporary ? "<w:temporary/>" : ""}<w:showingPlcHdr/>${b.bind ? `<w:dataBinding w:prefixMappings="${b.bind.ns}" w:xpath="${b.bind.xpath}" w:storeItemID="${b.bind.store}"/><w:text w:multiLine="1"/>` : ""}</w:sdtPr>`;
};

/** A box inside a paragraph. */
const inBox = (b: Box) => {
  return `<w:sdt>${boxPr(b)}<w:sdtContent>${run(b.text, b.style)}</w:sdtContent></w:sdt>`;
};

/** A box around a whole paragraph. */
const boxPara = (b: Box) => {
  return `<w:sdt>${boxPr(b)}<w:sdtContent><w:p>${run(b.text, b.style)}</w:p></w:sdtContent></w:sdt>`;
};

const wp = (...parts: string[]) => {
  return `<w:p>${parts.join("")}</w:p>`;
};

const bodyText = "Entrez le corps de la lettre :";

export async function lettreControles(): Promise<Buffer> {
  const body = [
    boxPara({
      title: "Entrez votre nom :",
      text: "Votre nom",
      bind: SENDER,
    }),
    wp(
      inBox({
        title: "Entrez l’adresse postale :",
        text: "Adresse postale",
        temporary: true,
      }),
    ),
    boxPara({
      title: "Entrez le code postal et la ville :",
      text: "Ville, rue et code postal",
      temporary: true,
    }),
    boxPara({
      title: "Entrez la date :",
      text: "Date",
      bind: LETTER_DATE,
    }),
    wp(),
    boxPara({
      title: "Entrez le nom du destinataire :",
      text: "Nom du destinataire",
      bind: RECIPIENT,
    }),
    wp(
      inBox({
        title: "Entrez le titre :",
        text: "Titre",
        temporary: true,
      }),
    ),
    boxPara({
      title: "Entrez le nom de la compagnie d’assurance :",
      text: "Compagnie d’assurance",
      bind: INSURER,
    }),
    wp(
      inBox({
        title: "Entrez votre adresse :",
        text: "Adresse postale",
        temporary: true,
      }),
    ),
    boxPara({
      title: "Entrez la ville et le code postal :",
      text: "Ville, rue et code postal",
      temporary: true,
    }),
    wp(
      run("Cher/Chère "),
      inBox({
        title: "Nom du destinataire :",
        text: "Nom du destinataire",
        bind: RECIPIENT,
      }),
      run(" :"),
    ),
    wp(
      inBox({
        title: bodyText,
        text: "J’ai été très surpris(e) en lisant ma facture annuelle d’assurance automobile : ma prime a augmenté sans raison apparente.",
        temporary: true,
      }),
    ),
    wp(
      inBox({
        title: bodyText,
        text: "Mon utilisation du véhicule n’a pas changé cette année et rien ne justifie cette hausse. En tant que client de longue date de",
        temporary: true,
      }),
      run(" "),
      inBox({
        title: "Entrez le nom de la compagnie d’assurance :",
        text: "Compagnie d’assurance",
        bind: INSURER,
        style: "Rfrencelgre",
      }),
      inBox({
        title: bodyText,
        text: ", je conteste cette augmentation de",
        temporary: true,
      }),
      run(" "),
      inBox({
        title: "Entrez le pourcentage d’augmentation :",
        text: "pourcentage d’augmentation",
        temporary: true,
        style: "Rfrencelgre",
      }),
      inBox({
        title: bodyText,
        text: " pourcent !",
        temporary: true,
      }),
    ),
    wp(
      run("Numéro de police : "),
      inBox({
        title: "Numéro de police",
        text: "Cliquez ou appuyez ici pour entrer du texte.",
        style: "Textedelespacerserv",
      }),
    ),
    wp(
      inBox({
        title: "Table des matières",
        text: "Aucune entrée de table des matières n’a été trouvée.",
        gallery: "Table of Contents",
      }),
    ),
    wp(
      inBox({
        title: "Cordialement :",
        text: "Cordialement",
        temporary: true,
      }),
    ),
    boxPara({
      title: "Entrez votre nom :",
      text: "Votre nom",
      bind: SENDER,
    }),
  ];
  const header = [
    boxPara({
      title: "Nom du destinataire :",
      text: "Nom du destinataire",
      bind: RECIPIENT,
    }),
    boxPara({
      title: "Entrez la date :",
      text: "Date",
      bind: LETTER_DATE,
    }),
  ];

  const xml = (s: string) => {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`;
  };

  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    ),
  );

  zip.file(
    "_rels/.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    ),
  );

  zip.file(
    "word/_rels/document.xml.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`,
    ),
  );

  zip.file(
    "word/styles.xml",
    xml(
      `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style><w:style w:type="character" w:default="1" w:styleId="Policepardfaut"><w:name w:val="Default Paragraph Font"/></w:style><w:style w:type="character" w:styleId="Textedelespacerserv"><w:name w:val="Placeholder Text"/><w:basedOn w:val="Policepardfaut"/><w:rPr><w:color w:val="808080"/></w:rPr></w:style><w:style w:type="character" w:styleId="Rfrencelgre"><w:name w:val="Subtle Reference"/><w:basedOn w:val="Policepardfaut"/><w:rPr><w:color w:val="5A5A5A"/></w:rPr></w:style></w:styles>`,
    ),
  );

  zip.file(
    "word/document.xml",
    xml(
      `<w:document ${W}><w:body>${body.join("")}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ),
  );

  zip.file("word/header1.xml", xml(`<w:hdr ${W}>${header.join("")}</w:hdr>`));

  zip.file(
    "docProps/core.xml",
    xml(
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>SYNTHETIC TEST FIXTURE</dc:title><dc:subject></dc:subject><cp:keywords></cp:keywords><cp:category></cp:category></cp:coreProperties>`,
    ),
  );

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
}
