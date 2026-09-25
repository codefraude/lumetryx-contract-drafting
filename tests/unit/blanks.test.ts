import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { Field } from "@/features/documents/contracts/fields";
import { outstandingFields } from "@/features/documents/progress";
import { detectMarkers } from "@/server/docx/detect";
import { loadDocxPackage, serializePackage } from "@/server/docx/package";
import { applyTextEdits, indexBlocks } from "@/server/docx/render";
import { buildFields } from "@/server/fields/build-fields";
import { draftEdits } from "@/server/fields/draft-edits";
import type { TemplateAnalysis } from "@/server/fields/template-analysis";

const run = (text: string, props = "") => {
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
};

const para = (...runs: string[]) => {
  return `<w:p>${runs.join("")}</w:p>`;
};

const cell = (content: string) => {
  return `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
};

const row = (...cells: string[]) => {
  return `<w:tr>${cells.join("")}</w:tr>`;
};

const EMPTY_WITH_RUN =
  '<w:p><w:r><w:rPr><w:sz w:val="21"/></w:rPr></w:r></w:p>';

const NOTICES = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${[
  row(
    cell(para(run("Notice detail"))),
    cell(para(run("Party A"))),
    cell(para(run("Party B"))),
  ),
  row(
    cell(para(run("Contact name"))),
    cell(para(run("{{party_a_contact}}"))),
    cell(para(run("{{party_b_contact}}"))),
  ),
  row(
    cell(para(run("Email address"))),
    cell(EMPTY_WITH_RUN),
    cell(para(run("{{party_b_email}}"))),
  ),
].join("")}</w:tbl>`;

async function template(body: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(
    new Uint8Array(readFileSync("fixtures/synthetic-mutual-nda.docx")),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const sectPr = /<w:sectPr[\s\S]*<\/w:sectPr>/.exec(xml)?.[0] ?? "";

  zip.file(
    "word/document.xml",
    xml.replace(
      /<w:body>[\s\S]*<\/w:body>/,
      `<w:body>${body}${sectPr}</w:body>`,
    ),
  );

  return zip.generateAsync({ type: "uint8array" });
}

async function analyse(body: string, analysis: TemplateAnalysis | null = null) {
  const pkg = await loadDocxPackage(await template(body));
  const blocks = (await indexBlocks(pkg)).filter(
    (b) => b.part === "word/document.xml",
  );
  const markers = detectMarkers(blocks);

  return {
    pkg,
    blocks,
    markers,
    built: buildFields(blocks, markers, analysis),
  };
}

const answer = (fields: Field[], id: string, value: string) => {
  const f = fields.find((x) => x.id === id);

  if (!f) {
    throw new Error(`no field ${id}`);
  }

  Object.assign(f, {
    status: "confirmed",
    rawValue: value,
    displayValue: value,
  });
};

async function filled(
  pkg: Awaited<ReturnType<typeof loadDocxPackage>>,
  fields: Field[],
) {
  await applyTextEdits(pkg, draftEdits(fields, "en"));
  const out = await serializePackage(pkg);
  const doc = await (
    await JSZip.loadAsync(out)
  )
    .file("word/document.xml")!
    .async("string");
  const blocks = await indexBlocks(await loadDocxPackage(out));

  return {
    doc,
    text: (ordinal: number) => {
      return blocks.find((b) => b.id === `word/document.xml#${ordinal}`)?.text;
    },
  };
}

describe("blank lines drawn with underlined spaces", () => {
  const body = para(
    run("The parties intend to evaluate "),
    run("                 ", '<w:u w:val="single"/>'),
    run(". Information may be used only for that purpose."),
  );

  it("become a field, like a line of underscores", async () => {
    const { markers, built } = await analyse(body);
    const blank = markers.find((m) => m.marker === "line");

    expect(blank).toMatchObject({
      blockId: "word/document.xml#0",
      start: 31,
      end: 48,
    });

    expect(built.fields).toHaveLength(1);

    expect(built.fields[0]?.occurrences[0]).toMatchObject({
      mode: "replace",
      expected: " ".repeat(17),
    });
  });

  it("are filled without the underline, leaving the sentence around them", async () => {
    const { pkg, built } = await analyse(body);
    const id = built.fields[0]!.id;

    answer(built.fields, id, "a joint venture");
    const { doc, text } = await filled(pkg, built.fields);

    expect(text(0)).toBe(
      "The parties intend to evaluate a joint venture. Information may be used only for that purpose.",
    );

    expect(doc).not.toContain("<w:u ");
  });

  it("are not fields when they are a signature line or only a few spaces", async () => {
    const { markers } = await analyse(
      para(run("Signed by: "), run("            ", '<w:u w:val="single"/>')) +
        para(run("A "), run("  ", '<w:u w:val="single"/>'), run(" gap")),
    );

    expect(markers.filter((m) => m.marker === "line")).toEqual([]);
  });
});

describe("empty cells in a fill-in table", () => {
  it("become a field named after the row and the column", async () => {
    const { markers, built } = await analyse(NOTICES);
    const empty = markers.filter((m) => m.marker === "cell");

    expect(empty).toHaveLength(1);

    expect(empty[0]).toMatchObject({
      blockId: "word/document.xml#7",
      labelHint: "Email address (Party A)",
    });

    const f = built.fields.find((x) => x.label === "Email address (Party A)");

    expect(f?.valueType).toBe("email");

    expect(f?.occurrences[0]).toMatchObject({
      blockId: "word/document.xml#7",
      mode: "insert",
      start: 0,
      end: 0,
    });
  });

  it("are filled in their own cell, even when the cell holds no text run", async () => {
    const bare = NOTICES.replace(EMPTY_WITH_RUN, "<w:p/>");

    for (const body of [NOTICES, bare]) {
      const { pkg, built } = await analyse(body);
      const f = built.fields.find(
        (x) => x.label === "Email address (Party A)",
      )!;

      answer(built.fields, f.id, "contact@example.com");
      const { text } = await filled(pkg, built.fields);

      expect(text(6)).toBe("Email address");
      expect(text(7)).toBe("contact@example.com");
    }
  });

  it("are left alone in a table with no blanks at all", async () => {
    const plain = NOTICES.replace("{{party_a_contact}}", "Jane")
      .replace("{{party_b_contact}}", "John")
      .replace("{{party_b_email}}", "john@example.com");
    const { markers } = await analyse(plain);

    expect(markers.filter((m) => m.marker === "cell")).toEqual([]);
  });

  it("keep the model from writing a value into the row's label cell", async () => {
    const analysis: TemplateAnalysis = {
      fields: [
        {
          id: "party_a_email",
          label: "Party A email address",
          question: "What is Party A's email address?",
          valueType: "text",
          group: "parties",
          required: true,
          markerKeys: [],
          implicit: [
            {
              blockId: "word/document.xml#6",
              quote: "Email address",
              replace: false,
            },
          ],
        },
      ],
      notFields: [],
      conditions: [],
      proposedRules: [],
    };
    const { built } = await analyse(NOTICES, analysis);

    expect(built.fields.find((f) => f.id === "party_a_email")).toBeUndefined();
    expect(built.rejected.join(" ")).toMatch(/label cell/);
  });
});

describe("question order", () => {
  it("follows the document within a group, whatever order the model listed fields in", async () => {
    const analysis: TemplateAnalysis = {
      fields: [
        {
          id: "party_b_email",
          label: "Party B email address",
          question: "What is Party B's email address?",
          valueType: "text",
          group: "parties",
          required: true,
          markerKeys: ["k:party b email"],
          implicit: [],
        },
        {
          id: "party_a_contact",
          label: "Party A contact",
          question: "Who is Party A's contact?",
          valueType: "party",
          group: "parties",
          required: true,
          markerKeys: ["k:party a contact"],
          implicit: [],
        },
      ],
      notFields: [],
      conditions: [],
      proposedRules: [],
    };
    const { built } = await analyse(NOTICES, analysis);

    expect(outstandingFields(built.fields).map((f) => f.label)).toEqual([
      "Party A contact",
      "Party b contact",
      "Email address (Party A)",
      "Party B email address",
    ]);
  });
});

describe("labels the model copies from a blank", () => {
  it("never end up empty or padded with spaces", async () => {
    const body =
      para(
        run("The parties intend to evaluate "),
        run("                 ", '<w:u w:val="single"/>'),
        run("."),
      ) + para(run("Return them within ________ days."));
    const bare = await analyse(body);
    const [line, underscore] = bare.markers;

    const field = (id: string, label: string, key: string) => {
      return {
        id,
        label,
        question: "?",
        valueType: "text" as const,
        group: "other" as const,
        required: true,
        markerKeys: [key],
        implicit: [],
      };
    };

    const { built } = await analyse(body, {
      fields: [
        field("purpose", "evaluate ____", line!.key),
        field("return_deadline", "________", underscore!.key),
      ],
      notFields: [],
      conditions: [],
      proposedRules: [],
    });

    expect(built.fields.map((f) => f.label)).toEqual([
      "Evaluate",
      "Return deadline",
    ]);
  });
});

describe("a bilingual fee table", () => {
  const FEES = `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>${[
    row(
      cell(para(run("Item / Élément"))),
      cell(para(run("Agreed value / Valeur convenue"))),
    ),
    row(
      cell(para(run("Total fee / Prix total"))),
      cell(para(run("{{total_fee}}"))),
    ),
    row(
      cell(para(run("Payment deadline in days / Délai de paiement en jours"))),
      cell(EMPTY_WITH_RUN),
    ),
  ].join(
    "",
  )}</w:tbl>${para(run("Target completion / Fin prévue : {{completion_date}}."))}`;

  it("names an empty cell after its row alone when there is one value column, and types days as a duration", async () => {
    const { built } = await analyse(FEES);
    const f = built.fields.find((x) => x.label.startsWith("Payment deadline"));

    expect(f?.label).toBe(
      "Payment deadline in days / Délai de paiement en jours",
    );

    expect(f?.valueType).toBe("duration");
  });

  it("does not let the model put a marker named as a date into a field of another type", async () => {
    const { built } = await analyse(FEES, {
      fields: [
        {
          id: "payment_deadline",
          label: "Payment deadline in days",
          question: "How many days?",
          valueType: "number",
          group: "money",
          required: true,
          markerKeys: ["k:completion date"],
          implicit: [],
        },
      ],
      notFields: [],
      conditions: [],
      proposedRules: [],
    });

    expect(
      built.fields.find((f) => f.id === "payment_deadline"),
    ).toBeUndefined();

    expect(
      built.fields.find((f) => f.label === "Completion date")?.valueType,
    ).toBe("date");

    expect(built.rejected.join(" ")).toMatch(/completion date/);
  });
});
