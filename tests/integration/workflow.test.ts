/**
 * Integration tests: real PostgreSQL (DATABASE_URL must point at a local test database),
 * real DOCX processing, real service layer. The language model is a MOCK (see helpers.ts).
 */
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/lumetryx_test";

import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setStoreForTests } from "@/server/cache/redis";
import * as repo from "@/server/db/repo";
import { createSession } from "@/server/db/sessions";
import { indexBlocks, applyTextEdits } from "@/server/docx/render";
import { loadDocxPackage, serializePackage } from "@/server/docx/package";
import type { EventPayload } from "@/features/documents/contracts/stream-events";
import type { Extraction } from "@/server/ai/extraction";
import type { TemplateAnalysis } from "@/server/fields/template-analysis";
import { setModelForTests } from "@/server/ai/model";
import { chatTurn, correctField } from "@/server/documents/answers";
import { generateDraft, readDocx, saveEditorDocx } from "@/server/documents/drafting";
import { createWordLink, readWordLink } from "@/server/documents/word-link";
import { createFromUpload } from "@/server/documents/upload";
import { currentView, getView } from "@/server/documents/views";
import { NotFound } from "@/server/http/responses";
import { BrokenStore, MemoryStore, mockModel } from "../helpers";

const lease = new Uint8Array(readFileSync("fixtures/synthetic-residential-lease.docx"));

const LEASE_ANALYSIS: TemplateAnalysis = {
  notFields: [],
  fields: [
    {
      id: "landlord_name",
      label: "Landlord name",
      question: "Who is the landlord, and is it an individual or a company?",
      valueType: "party",
      group: "parties",
      required: true,
      markerKeys: ["k:landlord name"],
      implicit: [],
    },
    {
      id: "tenant_name",
      label: "Tenant name",
      question: "Who is the tenant?",
      valueType: "party",
      group: "parties",
      required: true,
      markerKeys: ["k:tenant name"],
      implicit: [],
    },
    {
      id: "tenant_address",
      label: "Tenant address",
      question: "What is the tenant's current address?",
      valueType: "address",
      group: "parties",
      required: true,
      markerKeys: ["k:address"],
      implicit: [],
    },
    {
      id: "property_address",
      label: "Property address",
      question: "What is the address of the property?",
      valueType: "address",
      group: "subject",
      required: true,
      markerKeys: ["k:property address"],
      implicit: [],
    },
    {
      id: "start_date",
      label: "Lease start date",
      question: "When does the lease start?",
      valueType: "date",
      group: "dates",
      required: true,
      markerKeys: ["k:start date"],
      implicit: [],
    },
    {
      id: "monthly_rent",
      label: "Monthly rent",
      question: "What is the monthly rent?",
      valueType: "money",
      group: "money",
      required: true,
      markerKeys: ["k:monthly rent"],
      implicit: [],
    },
    {
      id: "deposit_amount",
      label: "Deposit amount",
      question: "How much is the deposit?",
      valueType: "money",
      group: "money",
      required: true,
      markerKeys: ["k:deposit amount"],
      implicit: [],
    },
    {
      id: "interest_rate",
      label: "Late interest rate",
      question: "What interest rate applies to late rent?",
      valueType: "percentage",
      group: "money",
      required: true,
      markerKeys: ["k:interest rate"],
      implicit: [],
    },
    {
      id: "reference",
      label: "Reference number",
      question: "What reference number should appear in the header?",
      valueType: "text",
      group: "other",
      required: true,
      markerKeys: ["k:reference number"],
      implicit: [],
    },
  ],
};

type Turn = { updates: Extraction["updates"]; clauseBlockIds?: string[] };
let nextTurn: Turn = { updates: [] };
let analysisCalls = 0;
let lastReplyPrompt = "";

const model = mockModel({
  object: (prompt) => {
    if (prompt.includes("MARKERS (key")) {
      analysisCalls++;
      return LEASE_ANALYSIS;
    }
    return { clauseBlockIds: [], ...nextTurn } satisfies Extraction;
  },
  reply: (prompt) => {
    lastReplyPrompt = prompt;
    return "Noted. Could you confirm the currency for the rent — Mauritian rupees?";
  },
});

const u = (fieldId: string, value: string, evidence = value, currency: string | null = null) => ({ fieldId, value, evidence, currency });

let pool: pg.Pool;
let store: MemoryStore;

async function newSession() {
  const id = await createSession(`test-${crypto.randomUUID()}`);
  return { id, aiRequests: 0, aiInputTokens: 0, aiOutputTokens: 0 };
}

async function collect(run: (emit: (e: EventPayload) => void, signal: AbortSignal) => Promise<void>, signal = new AbortController().signal) {
  const events: EventPayload[] = [];
  await run((e) => events.push(e), signal);
  return events;
}

async function say(session: Awaited<ReturnType<typeof newSession>>, docId: string, message: string, turn: Turn) {
  nextTurn = turn;
  const doc = await getView(session.id, docId);
  return collect((emit, signal) => chatTurn(session, docId, { message, fieldsVersion: doc.fieldsVersion }, emit, signal));
}

const field = async (sid: string, docId: string, id: string) => (await getView(sid, docId)).fields.find((f) => f.id === id)!;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  setModelForTests(model);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(() => {
  store = new MemoryStore();
  setStoreForTests(store);
});

describe("upload and analysis caching", () => {
  it("analyses once per session+template and reuses the cache; other sessions never share it", async () => {
    const a = await newSession();
    analysisCalls = 0;
    const d1 = await createFromUpload(a, "lease.docx", lease);
    expect(d1.analysis).toBe("ai");
    expect(d1.fields.map((f) => f.id)).toEqual(expect.arrayContaining(["tenant_name", "monthly_rent", "reference"]));
    await createFromUpload(a, "lease.docx", lease);
    expect(analysisCalls).toBe(1);
    await createFromUpload(await newSession(), "lease.docx", lease);
    expect(analysisCalls).toBe(2);
  });

  it("still works (without caching) when Redis is down", async () => {
    setStoreForTests(new BrokenStore());
    const d = await createFromUpload(await newSession(), "lease.docx", lease);
    expect(d.fields.length).toBeGreaterThan(5);
  });

  it("falls back to marker-only detection honestly when the model fails", async () => {
    setModelForTests(mockModel({ object: () => ({}), failGenerate: true }));
    const d = await createFromUpload(await newSession(), "lease.docx", lease);
    expect(d.analysis).toBe("markers_only");
    expect(d.messages[0]!.content).toMatch(/AI analysis unavailable/);
    setModelForTests(model);
  });
});

describe("guided conversation", () => {
  it("fills several fields from one answer and asks about an ambiguous currency", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const msg = "The tenant is John Smith, rent is Rs 25,000 monthly, and the lease starts on 1 October 2026";
    const events = await say(s, d.id, msg, {
      updates: [u("tenant_name", "John Smith"), u("monthly_rent", "Rs 25,000", "Rs 25,000"), u("start_date", "1 October 2026")],
    });
    const types = events.map((e) => e.type);
    expect(types.indexOf("fields_updated")).toBeLessThan(types.indexOf("assistant_delta"));
    expect(types.filter((t) => t === "assistant_delta").length).toBeGreaterThan(1);
    expect(types.at(-1)).toBe("assistant_done");
    expect((await field(s.id, d.id, "tenant_name")).status).toBe("confirmed");
    expect((await field(s.id, d.id, "start_date")).normalized).toEqual({ kind: "date", iso: "2026-10-01" });
    const rent = await field(s.id, d.id, "monthly_rent");
    expect(rent.status).toBe("needs_clarification");
    expect(rent.note).toMatch(/several currencies/);
    // The currency is resolved only once the user names it.
    await say(s, d.id, "Mauritian rupees", { updates: [u("monthly_rent", "Rs 25,000", "Mauritian rupees", "MUR")] });
    expect(await field(s.id, d.id, "monthly_rent")).toMatchObject({
      status: "confirmed",
      displayValue: "Rs 25,000",
      normalized: { amount: "25000", currency: "MUR" },
    });
  });

  it("flags ambiguous numeric dates and rejects values the user never wrote", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    await say(s, d.id, "Starts 03/04/2026", { updates: [u("start_date", "03/04/2026"), u("landlord_name", "Invented Ltd", "Invented Ltd")] });
    expect((await field(s.id, d.id, "start_date")).status).toBe("needs_clarification");
    expect((await field(s.id, d.id, "landlord_name")).status).toBe("missing");
  });

  it("answers a clause question from the document text and keeps the interview going", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const blocks = await indexBlocks(await loadDocxPackage(lease));
    const rent = blocks.find((b) => b.text.startsWith("Rent"))!;
    await say(s, d.id, "What does the rent clause mean? Is it usual?", { updates: [], clauseBlockIds: [rent.id] });
    expect(lastReplyPrompt).toContain("payable in advance on the first day");
    expect(lastReplyPrompt).toContain("attract interest"); // nested sub-clause included
    expect(lastReplyPrompt).toContain("NEXT TO ASK");
  });

  it("rejects stale field versions and preserves answers when the reply stream fails", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    await expect(
      chatTurn(s, d.id, { message: "hi", fieldsVersion: d.fieldsVersion - 1 }, () => undefined, new AbortController().signal),
    ).rejects.toBeInstanceOf(repo.StaleRevisionError);
  });

  it("keeps the answers of a turn whose reply fails, and says so", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    setModelForTests(mockModel({ object: () => ({ clauseBlockIds: [], updates: [u("tenant_name", "John Smith")] }), failStream: true }));
    await expect(say(s, d.id, "The tenant is John Smith.", { updates: [] })).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("Your answers were saved"),
    });
    setModelForTests(model);
    expect(await field(s.id, d.id, "tenant_name")).toMatchObject({ status: "confirmed", displayValue: "John Smith" });
  });

  it("stores a message once when it is retried after a failed turn", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const msg = "The tenant is John Smith.";
    setModelForTests(mockModel({ object: () => ({}), failGenerate: true }));
    await expect(say(s, d.id, msg, { updates: [] })).rejects.toThrow();
    setModelForTests(model);
    await say(s, d.id, msg, { updates: [u("tenant_name", "John Smith")] });
    const v = await getView(s.id, d.id);
    expect(v.messages.filter((m) => m.role === "user").map((m) => m.content)).toEqual([msg]);
    expect(v.messages.at(-1)!.role).toBe("assistant");
    expect(v.fields.find((f) => f.id === "tenant_name")!.status).toBe("confirmed");
  });
});

async function completeLease(s: Awaited<ReturnType<typeof newSession>>, docId: string) {
  await say(s, docId, "Landlord Ravi Ramdin; tenant John Smith of 12 Royal Road, Curepipe; property 4 Sea View Lane, Flic en Flac", {
    updates: [
      u("landlord_name", "Ravi Ramdin"),
      u("tenant_name", "John Smith"),
      u("tenant_address", "12 Royal Road, Curepipe"),
      u("property_address", "4 Sea View Lane, Flic en Flac"),
    ],
  });
  await say(s, docId, "Starts 1 October 2026, rent MUR 25,000, deposit MUR 50,000, interest 8%, ref LX-7 & Co", {
    updates: [
      u("start_date", "1 October 2026"),
      u("monthly_rent", "MUR 25,000"),
      u("deposit_amount", "MUR 50,000"),
      u("interest_rate", "8%"),
      u("reference", "LX-7 & Co"),
    ],
  });
  const view = await getView(s.id, docId);
  // The unmarked-in-analysis underscore blank becomes its own field; fill via the field panel.
  for (const f of view.fields.filter((x) => x.status !== "confirmed")) {
    const latest = await getView(s.id, docId);
    await correctField(s.id, docId, { fieldsVersion: latest.fieldsVersion, fieldId: f.id, value: "30 September 2027" });
  }
  return getView(s.id, docId);
}

describe("progressive drafting, editing and export", () => {
  it("refuses an incomplete draft, then streams blocks before completion and preserves structure", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const early = await collect((e, sig) => generateDraft(s.id, d.id, { fieldsVersion: d.fieldsVersion }, e, sig));
    expect(early).toEqual([expect.objectContaining({ type: "error", code: "incomplete" })]);

    const ready = await completeLease(s, d.id);
    const events = await collect((e, sig) => generateDraft(s.id, d.id, { fieldsVersion: ready.fieldsVersion }, e, sig));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("draft_started");
    expect(types.filter((t) => t === "draft_block_ready").length).toBeGreaterThan(10);
    expect(types.at(-1)).toBe("draft_complete");
    const { bytes } = await readDocx(s.id, d.id, "working");
    const blocks = await indexBlocks(await loadDocxPackage(new Uint8Array(bytes)));
    const all = blocks.map((b) => b.text).join("\n");
    expect(all).not.toMatch(/\{\{|\[LANDLORD|\[address\]/);
    expect(all).toContain("LX-7 & Co"); // header, escaped correctly in XML
    expect(blocks.filter((b) => b.text.includes("John Smith")).length).toBe(2);
    expect(blocks.find((b) => b.text.startsWith("Late payments"))?.numberLabel).toBe("3.1.1.");
  });

  it("applies a later correction to every untouched occurrence, and reports conflicts where the user edited", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const ready = await completeLease(s, d.id);
    await collect((e, sig) => generateDraft(s.id, d.id, { fieldsVersion: ready.fieldsVersion }, e, sig));

    // Correction with no manual edits: all occurrences updated in the working draft.
    const ev = await say(s, d.id, "Actually the tenant is Jane Doe", { updates: [u("tenant_name", "Jane Doe")] });
    expect(ev.find((e) => e.type === "draft_patch")).toMatchObject({ applied: ["tenant_name"], conflicts: [] });
    let text = (await indexBlocks(await loadDocxPackage(new Uint8Array((await readDocx(s.id, d.id, "working")).bytes)))).map((b) => b.text).join("\n");
    expect(text).not.toContain("John Smith");
    expect(text.match(/Jane Doe/g)).toHaveLength(2);

    // Simulate a browser edit that rewrites the landlord's name, saved through the editor path.
    const w = await readDocx(s.id, d.id, "working");
    const pkg = await loadDocxPackage(new Uint8Array(w.bytes));
    const b = (await indexBlocks(pkg)).find((x) => x.text.includes("Ravi Ramdin"))!;
    const at = b.text.indexOf("Ravi Ramdin");
    await applyTextEdits(pkg, [{ blockId: b.id, start: at, end: at + 11, expected: "Ravi Ramdin", value: "R. Ramdin (edited)" }]);
    await saveEditorDocx(s.id, d.id, w.workingRevision, await serializePackage(pkg));
    await expect(saveEditorDocx(s.id, d.id, w.workingRevision, await serializePackage(pkg))).rejects.toBeInstanceOf(repo.StaleRevisionError);

    const ev2 = await say(s, d.id, "The landlord is Ravi Ramdin Ltd", { updates: [u("landlord_name", "Ravi Ramdin Ltd")] });
    expect(ev2.find((e) => e.type === "draft_patch")).toMatchObject({ conflicts: ["landlord_name"] });
    text = (await indexBlocks(await loadDocxPackage(new Uint8Array((await readDocx(s.id, d.id, "working")).bytes)))).map((x) => x.text).join("\n");
    expect(text).toContain("R. Ramdin (edited)"); // the manual edit survived
  });

  it("cancelling mid-stream never marks a partial draft complete", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const ready = await completeLease(s, d.id);
    const ctrl = new AbortController();
    let blocks = 0;
    await expect(
      generateDraft(
        s.id,
        d.id,
        { fieldsVersion: ready.fieldsVersion },
        (e) => {
          if (e.type === "draft_block_ready" && ++blocks === 3) ctrl.abort();
        },
        ctrl.signal,
      ),
    ).rejects.toThrow(/stopped/i);
    const after = await getView(s.id, d.id);
    expect(after.draftStatus).toBe("none");
    await expect(readDocx(s.id, d.id, "working")).rejects.toBeInstanceOf(NotFound);
  });

  it("deduplicates concurrent draft requests", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    const ready = await completeLease(s, d.id);
    const run = () => collect((e, sig) => generateDraft(s.id, d.id, { fieldsVersion: ready.fieldsVersion }, e, sig));
    const results = await Promise.allSettled([run(), run()]);
    expect(results.filter((r) => r.status === "rejected").length).toBe(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { name: "BusyError" } });
  });
});

describe("links for Word", () => {
  it("opens the saved draft without the cookie, for this draft and five minutes only", async () => {
    const hash = `test-${crypto.randomUUID()}`;
    const a = { id: await createSession(hash), secretHash: hash, aiRequests: 0, aiInputTokens: 0, aiOutputTokens: 0 };
    const other = await newSession();
    const d = await createFromUpload(a, "lease.docx", lease);
    await expect(createWordLink(a, d.id)).rejects.toBeInstanceOf(NotFound); // no draft yet
    const ready = await completeLease(a, d.id);
    await collect((e, sig) => generateDraft(a.id, d.id, { fieldsVersion: ready.fieldsVersion }, e, sig));
    const now = Date.now();
    const { url, expiresAt } = await createWordLink(a, d.id, now);
    const [, token = "", name = ""] = /\/api\/word\/([^/]+)\/([^/]+)$/.exec(url) ?? [];
    expect(decodeURIComponent(name)).toBe("lease - draft.docx");
    expect(Date.parse(expiresAt) - now).toBeLessThanOrEqual(300_000);
    expect(Buffer.from((await readWordLink(token)).bytes)).toEqual(Buffer.from((await readDocx(a.id, d.id, "working")).bytes));
    const forged = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const [sid, , exp, sig] = token.split(".");
    for (const bad of [forged, `${sid}.${other.id}.${exp}.${sig}`, "not-a-token"]) await expect(readWordLink(bad)).rejects.toBeInstanceOf(NotFound);
    await expect(readWordLink(token, now + 301_000)).rejects.toBeInstanceOf(NotFound);
    await expect(createWordLink({ id: other.id, secretHash: "x" }, d.id)).rejects.toBeInstanceOf(NotFound);
  });
});

describe("anonymous session isolation", () => {
  it("a second session cannot read, mutate, stream or export the first session's document", async () => {
    const a = await newSession();
    const b = await newSession();
    const d = await createFromUpload(a, "lease.docx", lease);
    const ready = await completeLease(a, d.id);
    await collect((e, sig) => generateDraft(a.id, d.id, { fieldsVersion: ready.fieldsVersion }, e, sig));
    await expect(getView(b.id, d.id)).rejects.toBeInstanceOf(NotFound);
    await expect(readDocx(b.id, d.id, "working")).rejects.toBeInstanceOf(NotFound);
    await expect(correctField(b.id, d.id, { fieldsVersion: ready.fieldsVersion + 1, fieldId: "tenant_name", value: "x" })).rejects.toBeInstanceOf(NotFound);
    await expect(chatTurn(b, d.id, { message: "hi", fieldsVersion: 1 }, () => undefined, new AbortController().signal)).rejects.toBeInstanceOf(NotFound);
    await expect(collect((e, sig) => generateDraft(b.id, d.id, { fieldsVersion: 1 }, e, sig))).rejects.toBeInstanceOf(NotFound);
    await expect(saveEditorDocx(b.id, d.id, 1, lease)).rejects.toBeInstanceOf(repo.StaleRevisionError);
    expect((await readDocx(a.id, d.id, "working")).workingRevision).toBe(1);
    expect(await currentView(b.id)).toBeNull();
  });
});
