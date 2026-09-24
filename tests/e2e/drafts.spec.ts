import { expect, test, type Page } from "@playwright/test";

/**
 * Saved drafts, a second tab and draft switching, in markers-only mode. The last test stubs the
 * chat stream in the browser (no model involved) to finish a reply after another draft was opened.
 */
const ORIGIN = { Origin: process.env.APP_URL ?? "http://localhost:3000" };
type Doc = { id: string; fieldsVersion: number; fields: { id: string; label: string }[] };
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

const current = async (page: Page) => (await (await page.request.get("/api/documents/current")).json()).document as Doc;
const stage = (page: Page) => page.locator(".v2-super-editor__stage");
const drawer = (page: Page) => page.getByRole("dialog", { name: "Saved drafts" });

async function upload(page: Page, fixture: string) {
  await page.setInputFiles("input[type=file]", `fixtures/${fixture}.docx`);
  await expect(page.getByRole("heading", { level: 1, name: fixture })).toBeVisible({ timeout: 20_000 });
}

/** Starts a second draft from another template, as a user would. */
async function uploadAnother(page: Page, fixture: string) {
  await page.getByRole("button", { name: "New template" }).click();
  await page.getByRole("button", { name: "Choose a template" }).click();
  await upload(page, fixture);
}

async function openDraft(page: Page, title: string) {
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await drawer(page)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .click();
  await expect(drawer(page)).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function settle(page: Page) {
  await page.waitForFunction(() => {
    const s = document.querySelector(".v2-super-editor__stage");
    if (!s) return false;
    const a = (n: string) => s.getAttribute(`data-v2-render-scheduler-${n}`);
    return a("painted-sequence") === a("target-sequence") && a("action-painted-sequence") === a("action-target-sequence") && a("pending-action-count") === "0";
  });
  await page.waitForTimeout(150);
}

async function typeAtEndOf(page: Page, text: string, typed: string) {
  await settle(page);
  const el = stage(page).getByText(text, { exact: true }).first();
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await page.keyboard.press("End");
  await page.keyboard.type(typed);
}

test("saved drafts: open another draft, rename the open one and delete the other", async ({ page }) => {
  await page.goto("/");
  await upload(page, "synthetic-residential-lease");
  await uploadAnother(page, "synthetic-mutual-nda");
  await openDraft(page, "synthetic-residential-lease");

  // Renaming the open draft renames it in the header too.
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await drawer(page).getByRole("button", { name: "Actions for synthetic-residential-lease" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await drawer(page).getByLabel("Draft name").fill("Lease for Ravi");
  await drawer(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer(page).getByRole("button", { name: /^Lease for Ravi/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Lease for Ravi" })).toBeVisible();

  // Deleting the other draft asks first.
  await drawer(page).getByRole("button", { name: "Actions for synthetic-mutual-nda" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete draft" }).click();
  await expect(drawer(page).getByRole("button", { name: /^synthetic-mutual-nda/ })).toHaveCount(0);

  // Reopened, the drawer lists what the server has.
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await expect(drawer(page).getByRole("button", { name: /^Lease for Ravi/ })).toBeVisible();
  await expect(drawer(page).getByRole("button", { name: /^synthetic-mutual-nda/ })).toHaveCount(0);
});

test("an edit saved in another tab is detected, and the newer version can be loaded", async ({ page, context }) => {
  await page.goto("/");
  await upload(page, "synthetic-residential-lease");
  let doc = await current(page);
  for (const f of doc.fields)
    doc = await (
      await page.request.patch(`/api/documents/${doc.id}/fields`, {
        headers: ORIGIN,
        data: { fieldsVersion: doc.fieldsVersion, fieldId: f.id, value: VALUES[f.label] ?? "30 September 2027" },
      })
    ).json();
  await page.reload();
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });

  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByText(/^Saved at /)).toBeVisible({ timeout: 30_000 });

  await typeAtEndOf(page, "RESIDENTIAL LEASE AGREEMENT", " FROM-A");
  await page.getByRole("button", { name: "Save now" }).click();
  await expect(page.getByText(/^Saved at /)).toBeVisible({ timeout: 20_000 });

  // The second tab still edits the older revision: its save is refused, never silently merged.
  await typeAtEndOf(other, "The Tenant shall not:", " FROM-B");
  await other.getByRole("button", { name: "Save now" }).click();
  await expect(other.getByText("This draft was changed somewhere else.")).toBeVisible({ timeout: 20_000 });
  await other.getByRole("button", { name: "Load the newer version" }).click();
  await expect(stage(other).getByText("RESIDENTIAL LEASE AGREEMENT FROM-A").first()).toBeVisible({ timeout: 20_000 });
  await expect(stage(other).getByText("FROM-B", { exact: false })).toHaveCount(0);
  await expect(other.getByText("This draft was changed somewhere else.")).toHaveCount(0);
});

test("a reply that finishes after switching drafts does not change the draft opened meanwhile", async ({ page }) => {
  // Present documents as AI-analysed so the composer is enabled (markers-only mode disables it).
  await page.route(/\/api\/documents\/(current|[0-9a-f-]{36})$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const view = body.document ?? body;
    if (view) view.analysis = "ai";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await upload(page, "synthetic-residential-lease");
  const lease = await current(page);
  await uploadAnother(page, "synthetic-mutual-nda");
  await openDraft(page, "synthetic-residential-lease");

  // The lease's reply is held back until the NDA is open.
  let release = () => undefined as void;
  const switched = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/documents\/[^/]+\/chat$/, async (route) => {
    const { requestId, fieldsVersion } = route.request().postDataJSON() as { requestId: string; fieldsVersion: number };
    await switched;
    const frame = (e: object, seq: number) => `event: e\ndata: ${JSON.stringify({ ...e, requestId, seq })}\n\n`;
    const events = [
      { type: "fields_updated", fields: lease.fields, fieldsVersion: fieldsVersion + 1, changed: [lease.fields[0]!.id] },
      { type: "assistant_done", text: "Thanks, the tenant is recorded." },
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map(frame).join("") });
  });
  const replied = page.waitForResponse(/\/chat$/);
  await page.locator("#composer").fill("The tenant is John Smith.");
  await page.locator("#composer").press("Enter");
  await openDraft(page, "synthetic-mutual-nda");
  release();
  await replied;
  // The late events have been handled once the reply stops streaming (a check that passes at once proves nothing).
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await page.waitForTimeout(500);

  const details = page.locator("#assistant-panel-details");
  await expect(details).toContainText("Disclosing party name");
  await expect(details).not.toContainText("Tenant name");
  await expect(page.getByRole("region", { name: "Conversation" })).not.toContainText("the tenant is recorded");
});

test("a browser whose session is gone starts again, and the previous session's drafts are not shown", async ({ page, context }) => {
  await page.goto("/");
  await upload(page, "synthetic-residential-lease");
  await page.getByRole("button", { name: "Saved drafts" }).click();
  await expect(drawer(page).getByRole("button", { name: /^synthetic-residential-lease/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // The session cookie goes away (as when it expires): the next change is refused by the server.
  await context.clearCookies();
  await page.getByRole("tab", { name: /^Details/ }).click();
  const details = page.locator("#assistant-panel-details");
  await details.getByRole("button", { name: "Fill in" }).first().click();
  await details.getByRole("textbox").first().fill("John Smith");
  await details.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/no saved drafts session/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "synthetic-residential-lease" })).toHaveCount(0);

  // The cached list of the old session is gone too: while the list loads, the old draft never shows.
  await page.route("**/api/drafts", () => undefined);
  await page.getByRole("button", { name: "Saved drafts" }).first().click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByRole("button", { name: /^synthetic-residential-lease/ })).toHaveCount(0);
});
