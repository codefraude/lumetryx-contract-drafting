import { expect, test, type Page } from "@playwright/test";

/**
 * The chat surface, with the chat STREAM STUBBED in the browser: no model is involved, and nothing
 * here says anything about extraction quality (the service's integration tests and the live scenario
 * cover that). The document is presented as AI-analysed so the composer is enabled; every other
 * request reaches the real server. Checks: thinking indicator, inline failure with a retry that does
 * not repeat the message, the "details updated" acknowledgement, list formatting, and that new content
 * does not drag a reader who scrolled up.
 */
type Field = { id: string; label: string };
const frame = (e: object) => `event: e\ndata: ${JSON.stringify(e)}\n\n`;
const LONG =
  "Thanks, noted.\n\nBefore drafting I still need:\n- the landlord's full name\n- the property address\n- the start date\n\n" +
  "The monthly rent is written in the rent clause and in the schedule, so one answer fills both places. ".repeat(6);

async function open(page: Page) {
  // Present the document as AI-analysed so the composer is enabled (markers-only mode disables it).
  await page.route(/\/api\/documents\/(current|[0-9a-f-]{36})$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const view = body.document ?? body;
    if (view) view.analysis = "ai";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  await page.setInputFiles("input[type=file]", "fixtures/synthetic-residential-lease.docx");
  await expect(page.getByText(/still needed/)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(page.locator("#composer")).toBeEnabled();
  return ((await (await page.request.get("/api/documents/current")).json()).document as { fields: Field[]; fieldsVersion: number }).fields;
}

test("thinking, inline failure, retry without a duplicate message, acknowledgement and list formatting", async ({ page }) => {
  const fields = await open(page);
  let calls = 0;
  await page.route(/\/api\/documents\/[^/]+\/chat$/, async (route) => {
    const { requestId, fieldsVersion } = route.request().postDataJSON() as { requestId: string; fieldsVersion: number };
    calls++;
    await new Promise((r) => setTimeout(r, 700));
    const events =
      calls === 1
        ? [
            {
              type: "error",
              code: "unavailable",
              message: "Gemini is overloaded or down right now and did not reply. Wait a few seconds, then retry.",
              retryable: true,
            },
          ]
        : [
            { type: "fields_updated", fields, fieldsVersion, changed: [fields[0]!.id] },
            { type: "assistant_delta", text: LONG.slice(0, 40) },
            { type: "assistant_done", text: LONG },
          ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((e, seq) => frame({ ...e, requestId, seq })).join("") });
  });

  await page.locator("#composer").fill("The tenant is John Smith.");
  await page.locator("#composer").press("Enter");
  await expect(page.getByText("The assistant is working on a reply")).toBeAttached();
  await expect(page.locator("#composer"), "the sent message leaves the box").toHaveValue("");
  const failure = page.getByRole("alert").filter({ hasText: "Gemini is overloaded" });
  await expect(failure).toBeVisible();

  await failure.getByRole("button", { name: "Retry" }).click();
  const conversation = page.getByRole("region", { name: "Conversation" });
  await expect(conversation.getByText("1 detail updated")).toBeVisible();
  await expect(conversation.getByText("The tenant is John Smith."), "a retried message appears once").toHaveCount(1);
  await expect(conversation.locator("ul li")).toHaveCount(3);
  await expect(failure).toHaveCount(0);
  expect(calls).toBe(2);
});

test("new content does not move a reader who scrolled up; Jump to latest does", async ({ page }) => {
  const fields = await open(page);
  await page.route(/\/api\/documents\/[^/]+\/chat$/, async (route) => {
    const { requestId, fieldsVersion } = route.request().postDataJSON() as { requestId: string; fieldsVersion: number };
    await new Promise((r) => setTimeout(r, 900));
    const events = [
      { type: "fields_updated", fields, fieldsVersion, changed: [] },
      { type: "assistant_done", text: LONG },
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((e, seq) => frame({ ...e, requestId, seq })).join("") });
  });
  const conversation = page.getByRole("region", { name: "Conversation" });
  const send = async (text: string) => {
    await page.locator("#composer").fill(text);
    await page.locator("#composer").press("Enter");
  };
  for (const t of ["First answer.", "Second answer."]) {
    await send(t);
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({ timeout: 10_000 });
  }
  const atBottom = () => conversation.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 64);
  expect(await atBottom(), "follows new content while at the bottom").toBe(true);

  await send("Third answer.");
  await conversation.evaluate((el) => el.scrollTo({ top: 0 }));
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({ timeout: 10_000 });
  expect(await conversation.evaluate((el) => el.scrollTop), "the reply did not scroll the reader").toBeLessThan(40);
  const jump = page.getByRole("button", { name: /Jump to latest/ });
  await expect(jump).toContainText("new messages");
  await jump.click();
  await expect.poll(atBottom).toBe(true);
  await expect(jump).toHaveCount(0);
});
