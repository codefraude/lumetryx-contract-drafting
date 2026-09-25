import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import JSZip from "jszip";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const ORIGIN = { Origin: BASE };

test.skip(
  !process.env.E2E_LIVE_AI,
  "needs a server with a live Gemini key; set E2E_LIVE_AI=1",
);

test.setTimeout(300_000);

type Doc = {
  id: string;
  fieldsVersion: number;
  fields: {
    id: string;
    label: string;
    status: string;
    valueType: string;
    source: string;
    normalized: {
      kind: string;
      value?: unknown;
    } | null;
  }[];
  rules: {
    id: string;
    state: string;
    applied: string | null;
    pending: boolean;
  }[];
  language: { effective: string };
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

async function clickEndOf(page: Page, text: string) {
  await settle(page);
  const el = stage(page).getByText(text).first();

  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;

  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.keyboard.press("End");
}

const current = async (page: Page) => {
  return (await (await page.request.get("/api/documents/current")).json())
    .document as Doc;
};

async function chat(page: Page, text: string) {
  await page.locator("#composer").fill(text);
  await page.locator("#composer").press("Enter");

  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
    timeout: 90_000,
  });
}

async function open(dir: string): Promise<{
  ctx: BrowserContext;
  page: Page;
}> {
  const ctx = await chromium.launchPersistentContext(dir, {
    baseURL: BASE,
    acceptDownloads: true,
    viewport: {
      width: 1400,
      height: 900,
    },
    ...(process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
        }
      : {}),
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  page.on("dialog", (d) => void d.accept());

  return {
    ctx,
    page,
  };
}

test("bilingual employment: French answers, conditional non-compete, compare, resume, English, exclude, export", async () => {
  const profile = mkdtempSync(path.join(tmpdir(), "lx-profile-"));
  let { ctx, page } = await open(profile);
  const errors: string[] = [];

  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");

  for (let attempt = 1; ; attempt++) {
    await page.setInputFiles(
      "input[type=file]",
      "fixtures/synthetic-bilingual-employment.docx",
    );

    await expect(page.getByText(/still needed/)).toBeVisible({
      timeout: 60_000,
    });

    if (
      (await (await page.request.get("/api/documents/current")).json()).document
        .analysis === "ai" ||
      attempt === 3
    ) {
      break;
    }

    await page.getByRole("button", { name: "New template" }).click();
    await page.getByRole("button", { name: "Choose a template" }).click();
  }

  await expect(
    page.getByRole("group", { name: "Conversation language" }),
  ).toBeVisible();

  await expect(
    page.getByText("Bilingual template.", { exact: false }),
  ).toBeVisible();

  await chat(
    page,
    "L'employeur est Lumetryx Ltée et la salariée est Hélène Dupré-Lefèvre. Elle commence le 1er octobre 2026. Oui, elle est bien classée senior pour ce contrat.",
  );

  let doc = await current(page);

  expect(doc.language.effective).toBe("fr");

  expect(doc.fields.find((f) => f.id === "employee_is_senior")).toMatchObject({
    status: "confirmed",
    normalized: {
      kind: "boolean",
      value: true,
    },
  });

  expect(doc.rules[0]).toMatchObject({ state: "included" });

  for (let guard = 0; guard < 40; guard++) {
    doc = await current(page);
    const next = doc.fields.find(
      (f) => f.status !== "confirmed" && f.source !== "condition",
    );

    if (!next) {
      break;
    }

    const value =
      next.valueType === "date"
        ? "1 October 2026"
        : next.valueType === "money"
          ? "EUR 48000"
          : next.valueType === "duration"
            ? "12 months"
            : `Valeur ${next.label}`;

    await page.request.patch(`/api/documents/${doc.id}/fields`, {
      headers: ORIGIN,
      data: {
        fieldsVersion: doc.fieldsVersion,
        fieldId: next.id,
        value,
      },
    });
  }

  await page.reload();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 60_000 });
  await expect(stage(page).getByText("Non-competition").first()).toBeVisible();

  await clickEndOf(page, "Annual salary / Salaire annuel");
  await clickEndOf(page, "Annual salary / Salaire annuel");
  await page.keyboard.type(" (gross)");
  await clickEndOf(page, "after leaving, the Employee shall not work");
  await page.keyboard.type(" EDIT-P");

  await page.getByRole("tab", { name: "Compare with template" }).click();

  await expect(page.getByText(/changes? from the template/)).toBeVisible({
    timeout: 30_000,
  });

  await expect(
    page.getByText("including changes not saved yet", { exact: false }),
  ).toBeVisible();

  const compare = page.getByRole("region", {
    name: "Comparison with the template",
  });

  await expect(
    compare.getByText("(gross)", { exact: false }).first(),
  ).toBeVisible();

  await expect(
    compare.getByText("EDIT-P", { exact: false }).first(),
  ).toBeVisible();

  await expect(
    compare.getByText(/Table \d+, row 2, column 1/).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Next change" }).click();
  await page.screenshot({ path: "tests/output/e2e-compare.png" });
  await page.getByRole("tab", { name: "Draft" }).click();

  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });
  const savedId = (await current(page)).id;

  await ctx.close();
  ({ ctx, page } = await open(profile));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 60_000 });
  expect((await current(page)).id).toBe(savedId);

  await expect(
    stage(page).getByText("(gross)", { exact: false }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Drafts" }).click();

  await expect(
    page
      .getByRole("dialog", { name: "Saved drafts" })
      .getByText("synthetic-bilingual-employment", { exact: false })
      .first(),
  ).toBeVisible();

  await page
    .getByRole("dialog", { name: "Saved drafts" })
    .getByRole("button", { name: "Close" })
    .click();

  await page
    .getByRole("group", { name: "Conversation language" })
    .getByRole("button", { name: "English" })
    .click();

  await expect(page.getByText(/continue in English/)).toBeVisible();

  await chat(page, "Correction: the employee is not senior after all.");
  doc = await current(page);

  expect(
    doc.fields.find((f) => f.id === "employee_is_senior")!.normalized,
  ).toMatchObject({
    kind: "boolean",
    value: false,
  });

  expect(doc.rules[0]).toMatchObject({
    state: "excluded",
    applied: "included",
    pending: true,
  });

  await page.getByRole("tab", { name: /^Clauses/ }).click();
  await page.getByRole("button", { name: "Remove the clause" }).click();

  await expect(page.getByText("Your edited version is kept")).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 60_000 });
  await expect(stage(page).getByText("Non-competition")).toHaveCount(0);

  await page.getByRole("tab", { name: "Compare with template" }).click();

  await expect(page.getByText("Excluded: Employee is senior = No")).toBeVisible(
    { timeout: 30_000 },
  );

  await page.getByRole("tab", { name: "Draft" }).click();

  const downloading = page.waitForEvent("download");

  await page.getByRole("button", { name: "Download Word file" }).click();
  await page.getByRole("button", { name: "Download anyway" }).click();
  const download = await downloading;

  await download.saveAs("tests/output/e2e-bonuses.docx");
  const zip = await JSZip.loadAsync(
    readFileSync("tests/output/e2e-bonuses.docx"),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join("");

  expect(text).not.toContain("Non-competition");
  expect(text).not.toContain("EDIT-P");
  expect(text).toContain("(gross)");
  expect(text).toContain("Hélène Dupré-Lefèvre");
  expect(text).toContain("à compter du 1 octobre 2026");
  expect(text).toContain("from 1 October 2026");
  expect(text).toContain("subject to clause 3");
  expect(text).not.toMatch(/\[\[/);
  expect(xml).not.toMatch(/<w:ins |<w:del |lx-diff/);

  expect(await zip.file("word/numbering.xml")!.async("string")).toContain(
    'w:val="%1.%2.%3."',
  );

  expect(errors).toEqual([]);
  await ctx.close();
});
