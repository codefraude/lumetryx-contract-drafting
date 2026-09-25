import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";

/**
 * Light / dark / system theme, in markers-only mode (no Gemini key
 * needed). Checks the behaviour the theme must not change: the editor
 * instance, the document requests, the paper and the exported DOCX.
 */
const ORIGIN = { Origin: process.env.APP_URL ?? "http://localhost:3000" };

const theme = (page: Page) => {
  return page.evaluate(() => document.documentElement.dataset.theme);
};

const choose = (page: Page, label: "Light" | "Dark" | "System") => {
  return page.locator(`label[title^='${label}']`).first().click();
};

test("system theme is applied before the first paint and an explicit choice persists", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();
  const warnings: string[] = [];

  page.on(
    "console",
    (m) =>
      /hydrat|did not match|script tag/i.test(m.text()) &&
      warnings.push(m.text()),
  );

  await page.addInitScript(() =>
    document.addEventListener(
      "readystatechange",
      () =>
        document.readyState === "interactive" &&
        ((window as unknown as { first: string }).first =
          document.documentElement.dataset.theme ?? ""),
      { once: true },
    ),
  );

  await page.goto("/");

  expect(
    await page.evaluate(() => (window as unknown as { first: string }).first),
  ).toBe("dark");

  await choose(page, "Light");
  await expect.poll(() => theme(page)).toBe("light");
  await page.reload();
  expect(await theme(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });

  expect(await theme(page), "an explicit choice ignores OS changes").toBe(
    "light",
  );

  await choose(page, "System");
  await expect.poll(() => theme(page)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });

  await expect
    .poll(() => theme(page), { message: "System follows a later OS change" })
    .toBe("light");

  expect(warnings).toEqual([]);
  await ctx.close();
});

test("switching theme keeps the editor, unsaved input and the exported document", async ({
  page,
}) => {
  const errors: string[] = [];

  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await page.setInputFiles(
    "input[type=file]",
    "fixtures/synthetic-residential-lease.docx",
  );

  await expect(page.getByText(/still needed/)).toBeVisible({ timeout: 20_000 });
  await page.locator(".superdoc-page").first().waitFor();

  // Before a draft: an unsaved Details value and the
  // template view survive a theme change and a tab switch.
  await page.getByRole("tab", { name: /^Details/ }).click();
  await page.getByRole("button", { name: "Fill in" }).first().click();

  await page
    .locator("#assistant-panel-details")
    .getByRole("textbox")
    .fill("Unsaved value");

  await page
    .locator(".v2-super-editor__stage")
    .evaluate((el) => ((el as HTMLElement & { marker?: number }).marker = 1));

  await choose(page, "Dark");
  await expect.poll(() => theme(page)).toBe("dark");
  await page.getByRole("tab", { name: "Chat" }).click();
  await page.getByRole("tab", { name: /^Details/ }).click();

  expect(
    await page
      .locator("#assistant-panel-details")
      .getByRole("textbox")
      .inputValue(),
    "unsaved input survives the theme and tab switch",
  ).toBe("Unsaved value");

  expect(
    await page
      .locator(".v2-super-editor__stage")
      .evaluate((el) => (el as HTMLElement & { marker?: number }).marker),
    "the editor was not remounted",
  ).toBe(1);

  expect(
    await page
      .locator(".superdoc-page")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "the page stays paper",
  ).toBe("rgb(255, 255, 255)");

  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(25, 25, 24)");

  // With a draft: switching theme fetches and saves
  // nothing, and the export is identical in both themes.
  const values: Record<string, string> = {
    "Tenant name": "John Smith",
    "Landlord name": "Ravi Ramdin",
    Address: "12 Royal Road, Curepipe",
    "Property address": "4 Sea View Lane, Flic en Flac",
    "Start date": "1 October 2026",
    "Monthly rent": "MUR 25,000",
    "Deposit amount": "MUR 50,000",
    "Interest rate": "8%",
    "Reference number": "LX-7 & Co",
  };
  let doc = (await (await page.request.get("/api/documents/current")).json())
    .document as {
    id: string;
    fieldsVersion: number;
    fields: {
      id: string;
      label: string;
    }[];
  };

  for (const f of doc.fields) {
    doc = await (
      await page.request.patch(`/api/documents/${doc.id}/fields`, {
        headers: ORIGIN,
        data: {
          fieldsVersion: doc.fieldsVersion,
          fieldId: f.id,
          value: values[f.label] ?? "30 September 2027",
        },
      })
    ).json();
  }

  await page.reload();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });
  await page.locator(".superdoc-page").first().waitFor();

  const exportXml = async () => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Word file" }).click(),
    ]);
    const zip = await JSZip.loadAsync(readFileSync(await download.path()));

    return zip.file("word/document.xml")!.async("string");
  };

  const before = await exportXml();
  const docRequests: string[] = [];

  page.on(
    "request",
    (r) =>
      /\/api\/documents\/[^/]+\/(docx|compare|chat|draft)/.test(r.url()) &&
      docRequests.push(r.url()),
  );

  await page
    .locator(".v2-super-editor__stage")
    .evaluate((el) => ((el as HTMLElement & { marker?: number }).marker = 2));

  await choose(page, "Light");
  await expect.poll(() => theme(page)).toBe("light");

  expect(
    await page
      .locator(".v2-super-editor__stage")
      .evaluate((el) => (el as HTMLElement & { marker?: number }).marker),
    "the draft editor was not remounted",
  ).toBe(2);

  expect(docRequests, "the theme change fetched and saved nothing").toEqual([]);

  expect(
    await exportXml(),
    "the same content and formatting are exported in both themes",
  ).toBe(before);

  expect(errors).toEqual([]);
});
