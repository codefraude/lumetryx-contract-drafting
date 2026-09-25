import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * For every fixture, saves the draft exactly as the server filled
 * it and the same draft after a round trip through the editor (a
 * keystroke typed and deleted, then saved and downloaded), plus
 * the answers given. `npm run check:word` then opens them in
 * Microsoft Word. Markers-only mode: no model involved.
 */
const ORIGIN = { Origin: process.env.APP_URL ?? "http://localhost:3000" };
const OUT = "tests/output/word";
const FIXTURES = [
  "synthetic-mutual-nda",
  "synthetic-residential-lease",
  "synthetic-contrat-prestation-fr",
  "synthetic-bilingual-lease",
  "synthetic-bilingual-employment",
  "synthetic-lettre-controles-fr",
  "synthetic-supply-agreement",
];

type Field = {
  id: string;
  label: string;
  valueType: string;
  status: string;
  displayValue: string | null;
  occurrences: {
    blockId: string;
    expected: string;
  }[];
};

type Doc = {
  id: string;
  fieldsVersion: number;
  fields: Field[];
};

/**
 * An answer that validates for each kind of detail (an amount without
 * separators is unambiguous in French too); free-text answers name their field.
 */
const ANSWERS: Record<string, string> = {
  date: "1 October 2026",
  money: "MUR 25000",
  number: "3",
  percentage: "8%",
  duration: "12 months",
  jurisdiction: "Mauritius",
  boolean: "yes",
};

const answer = (f: Field) => {
  return ANSWERS[f.valueType] ?? `Sample ${f.label}`;
};

const current = async (page: Page) => {
  return (await (await page.request.get("/api/documents/current")).json())
    .document as Doc;
};

const stage = (page: Page) => {
  return page.locator(".v2-super-editor__stage");
};

async function settle(page: Page) {
  await page.waitForFunction(() => {
    const s = document.querySelector(".v2-super-editor__stage");

    if (!s) {
      return false;
    }

    const a = (n: string) => {
      return s.getAttribute(`data-v2-render-scheduler-${n}`);
    };

    return (
      a("painted-sequence") === a("target-sequence") &&
      a("action-painted-sequence") === a("action-target-sequence") &&
      a("pending-action-count") === "0"
    );
  });

  await page.waitForTimeout(150);
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

for (const name of FIXTURES) {
  test(`${name}: the filled draft and its editor round trip are saved for Word`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.setInputFiles("input[type=file]", `fixtures/${name}.docx`);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name,
      }),
    ).toBeVisible({
      timeout: 20_000,
    });

    let doc = await current(page);

    for (const f of doc.fields) {
      doc = await (
        await page.request.patch(`/api/documents/${doc.id}/fields`, {
          headers: ORIGIN,
          data: {
            fieldsVersion: doc.fieldsVersion,
            fieldId: f.id,
            value: answer(f),
          },
        })
      ).json();
    }

    expect(
      doc.fields.filter((f) => f.status !== "confirmed").map((f) => f.label),
    ).toEqual([]);

    // The server's own output, before the editor has opened it.
    const generated = await page.request.post(
      `/api/documents/${doc.id}/draft`,
      {
        headers: ORIGIN,
        data: {
          fieldsVersion: doc.fieldsVersion,
          requestId: crypto.randomUUID(),
        },
      },
    );

    expect(await generated.text()).toContain("draft_complete");

    writeFileSync(
      `${OUT}/${name}.filled.docx`,
      await (
        await page.request.get(`/api/documents/${doc.id}/docx?which=working`)
      ).body(),
    );

    // The editor's own save of the same draft: a keystroke
    // typed and deleted leaves the content as it was.
    await page.reload();
    await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });
    await settle(page);
    // A free-text answer (verbatim in any language, unlike dates and amounts)
    // that only occurs in the body: a click in the page header does not edit
    // the body. The painted page comes before the editor's hidden text layer.
    const inBody = doc.fields.find(
      (f) =>
        !(f.valueType in ANSWERS) &&
        f.occurrences.every((o) => o.blockId.startsWith("word/document.xml")),
    )!;
    const target = stage(page)
      .getByText(answer(inBody), { exact: false })
      .first();

    await target.scrollIntoViewIfNeeded();

    // The first click focuses the editor surface; the second places the caret.
    for (let i = 0; i < 2; i++) {
      await settle(page);
      const box = (await target.boundingBox())!;

      await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
    }

    await page.keyboard.press("End");
    await page.keyboard.type("x");
    // Deleting a selection, not Backspace: next to a placeholder
    // box, Backspace first selects the box, as in Word.
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Delete");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Word file" }).click(),
    ]);

    await download.saveAs(`${OUT}/${name}.roundtrip.docx`);

    writeFileSync(
      `${OUT}/${name}.json`,
      JSON.stringify(
        {
          fields: doc.fields.map((f) => ({
            label: f.label,
            answer: answer(f),
            shown: f.displayValue,
            placeholders: f.occurrences.map((o) => o.expected),
          })),
        },
        null,
        2,
      ),
    );
  });
}
