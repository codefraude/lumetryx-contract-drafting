import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";

/**
 * Browser E2E in markers-only mode (no Gemini key needed): upload → fill via Details API →
 * streamed draft → real editor edits → immediate download → inspect the DOCX package.
 */
const ORIGIN = { Origin: process.env.APP_URL ?? "http://localhost:3000" };
const VALUES: Record<string, string> = {
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

type Doc = { id: string; fieldsVersion: number; fields: { id: string; label: string }[] };

async function uploadAndFill(page: Page) {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", "fixtures/synthetic-residential-lease.docx");
  await expect(page.getByText(/still needed/)).toBeVisible({ timeout: 20_000 });
  let doc = (await (await page.request.get("/api/documents/current")).json()).document as Doc;
  for (const f of doc.fields) {
    doc = await (
      await page.request.patch(`/api/documents/${doc.id}/fields`, {
        headers: ORIGIN,
        data: { fieldsVersion: doc.fieldsVersion, fieldId: f.id, value: VALUES[f.label] ?? "30 September 2027" },
      })
    ).json();
  }
  await page.reload();
  return doc;
}

const stage = (page: Page) => page.locator(".v2-super-editor__stage");

/** Waits until SuperDoc's render scheduler has painted every pending change, so measured positions are current. */
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const s = document.querySelector(".v2-super-editor__stage");
    if (!s) return false;
    const a = (n: string) => s.getAttribute(`data-v2-render-scheduler-${n}`);
    return a("painted-sequence") === a("target-sequence") && a("action-painted-sequence") === a("action-target-sequence") && a("pending-action-count") === "0";
  });
  await page.waitForTimeout(150);
}

async function clickEndOf(page: Page, text: string, exact = false) {
  await settle(page);
  const el = stage(page).getByText(text, { exact }).first();
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.keyboard.press("End");
}

async function paragraphs(zipBytes: Buffer) {
  const zip = await JSZip.loadAsync(zipBytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({
    xml: m[0],
    text: [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
  }));
  return { zip, xml, paras };
}

test("progressive draft, real edits and immediate download preserve structure", async ({ page }) => {
  const external: string[] = [];
  page.on(
    "request",
    (r) =>
      !r.url().startsWith(process.env.APP_URL ?? "http://localhost:3000") &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:") &&
      external.push(r.url()),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await uploadAndFill(page);
  await page.getByRole("button", { name: "Generate draft" }).click();
  // The streamed preview appears before the editor takes over.
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });
  await expect(stage(page).getByText("John Smith").first()).toBeVisible();
  await page.screenshot({ path: "tests/output/e2e-draft-desktop.png" });

  // 1. Heading edit (the first click focuses the editor surface).
  // exact: the page header also contains "Residential Lease Agreement" (case-insensitive substring).
  await clickEndOf(page, "RESIDENTIAL LEASE AGREEMENT", true);
  await clickEndOf(page, "RESIDENTIAL LEASE AGREEMENT", true);
  await page.keyboard.type(" (DRAFT)");
  // 2. Formatted (italic) paragraph edit.
  await clickEndOf(page, "The Tenant shall not:");
  await page.keyboard.type(" at any time");
  // 3. Table cell edit.
  await clickEndOf(page, "Deposit", true);
  await page.keyboard.type(" (refundable)");
  // 4. Nested list: outdent 3.1.1 to level 2 with the toolbar.
  await clickEndOf(page, "Late payments attract interest");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Left indent", exact: true }).click();
  // 5. Toolbar: bold a new word, then undo/redo an insertion.
  await clickEndOf(page, "private residence.");
  await page.keyboard.type(" Strictly");
  for (let i = 0; i < "Strictly".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  // The editor groups keystrokes typed in quick succession into one undo step, as a person pausing would not.
  await page.waitForTimeout(800);
  await page.keyboard.press("End");
  await page.keyboard.type(" ZZZ");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.screenshot({ path: "tests/output/e2e-edited.png" });

  // Download immediately — the debounce has not fired; flush() must save first.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download Word file" }).click()]);
  expect(download.suggestedFilename()).toMatch(/draft\.docx$/);
  await download.saveAs("tests/output/e2e-download.docx");
  const bytes = readFileSync("tests/output/e2e-download.docx");
  const { zip, xml, paras } = await paragraphs(bytes);

  const heading = paras.find((p) => p.text.includes("RESIDENTIAL LEASE AGREEMENT"))!;
  expect(heading.text).toContain("(DRAFT)");
  expect(heading.xml).toMatch(/<w:pStyle w:val="Heading1"\s*\/>/);
  const italic = paras.find((p) => p.text.includes("The Tenant shall not:"))!;
  expect(italic.text).toContain("at any time");
  expect(italic.xml).toMatch(/<w:i\s*\/>/);
  expect(paras.some((p) => p.text.includes("Deposit (refundable)"))).toBe(true);
  expect(xml).toContain("<w:tbl>");
  const late = paras.find((p) => p.text.includes("Late payments"))!;
  expect(late.xml).toMatch(/<w:ilvl w:val="1"\s*\/>/);
  const strictly = paras.find((p) => p.text.includes("Strictly"))!;
  expect(strictly.xml).toMatch(/<w:b\s*\/>[\s\S]*?Strictly/);
  expect(strictly.text).not.toContain("ZZZ");
  // Structure that must survive the browser round trip.
  const numbering = await zip.file("word/numbering.xml")!.async("string");
  expect(numbering).toContain('w:val="%1.%2.%3."');
  const pgMar = xml.match(/<w:pgMar [^>]*>/)?.[0] ?? "";
  for (const side of ["top", "right", "bottom", "left"]) expect(pgMar).toContain(`w:${side}="1440"`);
  expect(xml).toContain("w:headerReference");
  const headerPart = Object.keys(zip.files).find((n) => /^word\/header\d*\.xml$/.test(n))!;
  expect(await zip.file(headerPart)!.async("string")).toContain("LX-7 &amp; Co");
  expect(xml).toContain("John Smith");

  expect(external, "no requests may leave this origin").toEqual([]);
  expect(errors).toEqual([]);
});

for (const vp of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
]) {
  test(`usable at ${vp.name} width without horizontal page overflow`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await page.screenshot({ path: `tests/output/e2e-upload-${vp.name}.png` });
    await uploadAndFill(page);
    const tabs = page.getByRole("navigation", { name: "Views" });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate draft" })).toBeVisible();
    await page.getByRole("button", { name: "Generate draft" }).click();
    await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await page.screenshot({ path: `tests/output/e2e-document-${vp.name}.png` });
    // Narrow screens scale the page to the width of its canvas: the whole page shows and nothing scrolls sideways.
    const canvas = await stage(page).evaluate((el) => {
      let c = el.parentElement;
      while (c && getComputedStyle(c).overflowX !== "auto") c = c.parentElement;
      return c ? { client: c.clientWidth, scroll: c.scrollWidth } : null;
    });
    expect(canvas, "the document sits in its own scrollable canvas").not.toBeNull();
    expect(canvas!.scroll).toBeLessThanOrEqual(canvas!.client + 1);
    const sheet = (await stage(page).locator(".superdoc-page").first().boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(vp.width + 1);
    // The scaled page is edited where it is tapped.
    await clickEndOf(page, "Premises", true);
    await clickEndOf(page, "Premises", true);
    await page.keyboard.type(" OK");
    await expect(stage(page).getByText("Premises OK").first()).toBeVisible();
    await tabs.getByRole("button", { name: "Chat" }).click();
    await expect(page.locator("#composer")).toBeVisible();
    await page.screenshot({ path: `tests/output/e2e-chat-${vp.name}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Switching back keeps the editor state (panels stay mounted).
    await tabs.getByRole("button", { name: "Document" }).click();
    await expect(stage(page).getByText("John Smith").first()).toBeVisible();
    // Compare and Saved drafts fit the viewport too.
    await page.getByRole("tab", { name: "Compare with template" }).click();
    await expect(page.getByText(/changes? from the template/)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `tests/output/e2e-compare-${vp.name}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByRole("tab", { name: "Draft" }).click();
    // Secondary actions sit in the "More actions" menu below desktop width.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Saved drafts" }).click();
    const drawer = page.getByRole("dialog", { name: "Saved drafts" });
    await expect(drawer.getByText("synthetic-residential-lease", { exact: false }).first()).toBeVisible();
    expect((await drawer.boundingBox())!.width).toBeLessThanOrEqual(vp.width + 0.5); // sub-pixel rounding while it slides in
    await page.screenshot({ path: `tests/output/e2e-drafts-${vp.name}.png` });
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(stage(page).getByText("John Smith").first()).toBeVisible();
  });
}

test("rejects an invalid upload with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("input[type=file]", { name: "contract.docx", mimeType: "application/octet-stream", buffer: Buffer.from("not a word file") });
  await expect(page.getByText("This file is not a Word .docx document.")).toBeVisible();
});
