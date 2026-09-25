import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const ORIGIN = { Origin: BASE };

type Field = {
  id: string;
  label: string;
  valueType: string;
  unit: string | null;
  status: string;
  occurrences: { lang: string }[];
};

type Doc = {
  id: string;
  fieldsVersion: number;
  fields: Field[];
};

const CASES = [
  {
    name: "01_Mutual_NDA",
    edit: "Signatures will be applied after review of the completed draft.",
    typed: " Révisé.",
    expectInDoc: ["Acme Holdings Ltd.", "NDA-2026-77"],
    italic: true,
  },
  {
    name: "02_Residential_Lease_Mixed_Placeholders",
    edit: "without the Landlord’s written agreement.",
    typed: " Révisé.",
    expectInDoc: ["Acme Holdings Ltd.", "PR-2026-77"],
    italic: false,
  },
  {
    name: "03_Bilingual_Services_Agreement",
    edit: "Les éléments de travail à remettre sont ceux expressément désignés ci-dessus.",
    typed: " Révisé.",
    expectInDoc: ["Acme Holdings Ltd.", "Texte en français"],
    italic: true,
  },
];

const value = (f: Field, lang?: string) => {
  if (lang === "fr") {
    return "Texte en français";
  }

  if (lang === "en") {
    return "English text";
  }

  if (f.unit) {
    return "7";
  }

  if (/reference/i.test(f.label + f.id)) {
    return /property/i.test(f.label + f.id) ? "PR-2026-77" : "NDA-2026-77";
  }

  return (
    {
      date: "1 October 2026",
      money: "EUR 1250",
      number: "3",
      percentage: "5%",
      email: "notices@example.com",
      currency: "EUR",
      party: "Acme Holdings Ltd.",
      address: "1 Main Street, Port Louis",
      boolean: "yes",
    }[f.valueType] ?? `Sample ${f.label}`
  );
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

async function fill(page: Page) {
  let doc = (await (await page.request.get("/api/documents/current")).json())
    .document as Doc;

  const patch = async (data: Record<string, unknown>) => {
    doc = await (
      await page.request.patch(`/api/documents/${doc.id}/fields`, {
        headers: ORIGIN,
        data: {
          fieldsVersion: doc.fieldsVersion,
          ...data,
        },
      })
    ).json();
  };

  let day = 1;

  for (const f of doc.fields) {
    const langs = [...new Set(f.occurrences.map((o) => o.lang))].filter(
      (l) => l === "en" || l === "fr",
    );

    if (
      f.valueType === "text" &&
      langs.length === 2 &&
      !/reference|name|title|email/i.test(f.label + f.id)
    ) {
      await patch({
        fieldId: f.id,
        value: value(f, "en"),
        lang: "en",
      });

      await patch({
        fieldId: f.id,
        value: value(f, "fr"),
        lang: "fr",
      });

      continue;
    }

    await patch({
      fieldId: f.id,
      value: f.valueType === "date" ? `${day++} October 2026` : value(f),
    });
  }

  return doc;
}

for (const c of CASES) {
  test(`${c.name}: draft, edit, switch the interface to French, export and resume`, async ({
    page,
  }) => {
    const errors: string[] = [];

    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");

    await page.setInputFiles(
      "input[type=file]",
      `fixtures/lumetryx/${c.name}.docx`,
    );

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: c.name,
      }),
    ).toBeVisible({ timeout: 20_000 });

    const doc = await fill(page);

    expect(
      doc.fields.filter((f) => f.status !== "confirmed").map((f) => f.label),
    ).toEqual([]);

    await page.reload();
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });
    await settle(page);

    const target = stage(page).getByText(c.edit).first();

    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();

    expect(box).not.toBeNull();

    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) - 1,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );

    await page.keyboard.press("End");
    await page.keyboard.type(c.typed);
    await expect(stage(page).getByText(c.typed.trim()).first()).toBeVisible();

    await stage(page).evaluate(
      (el) => ((el as HTMLElement & { marker?: number }).marker = 7),
    );

    const requests: string[] = [];

    page.on(
      "request",
      (r) =>
        /\/api\/documents\/[^/]+\/(docx|chat|draft|fields)/.test(r.url()) &&
        r.method() !== "PUT" &&
        requests.push(r.url()),
    );

    await page.locator("label[title='Français']").first().click();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await expect(
      page.getByRole("button", { name: "Télécharger le .docx" }),
    ).toBeVisible();

    expect(
      await stage(page).evaluate(
        (el) => (el as HTMLElement & { marker?: number }).marker,
      ),
      "the editor was not remounted",
    ).toBe(7);

    await expect(stage(page).getByText(c.typed.trim()).first()).toBeVisible();

    expect(requests, "switching language reloaded no document data").toEqual(
      [],
    );

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Télécharger le .docx" }).click(),
    ]);
    const zip = await JSZip.loadAsync(readFileSync(await download.path()));

    const paragraphs = async (part: string) => {
      const xml = (await zip.file(part)?.async("string")) ?? "";

      return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => ({
        xml: p[0],
        text: [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
          .map((m) => m[1])
          .join(""),
      }));
    };

    const bodyParas = await paragraphs("word/document.xml");
    const body = bodyParas.map((p) => p.text).join("\n");
    const header = (await paragraphs("word/header1.xml"))
      .map((p) => p.text)
      .join("\n");
    const edited = bodyParas.find((p) => p.text.includes(c.edit));

    expect(edited?.text).toContain(c.typed.trim());

    if (c.italic) {
      expect(edited?.xml).toMatch(/<w:i\s*\/>/);
    }

    for (const v of c.expectInDoc) {
      expect(`${header}\n${body}`).toContain(v);
    }

    expect(`${header}${body}`).not.toMatch(/\{\{|\}\}|\[[A-Z ]{3,}\]|_{4,}/);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await expect(page.getByText(/^Enregistré à /)).toBeVisible({
      timeout: 30_000,
    });

    await expect(stage(page).getByText(c.typed.trim()).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}
