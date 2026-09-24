/**
 * Integration tests for the four bonuses: real PostgreSQL (local test database), real DOCX
 * processing, real service layer. The language model is a MOCK (see helpers.ts) that counts calls.
 */
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/lumetryx_test";

import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setStoreForTests } from "@/server/cache/redis";
import * as repo from "@/server/db/repo";
import { applyTextEdits, indexBlocks } from "@/server/docx/render";
import { loadDocxPackage, serializePackage } from "@/server/docx/package";
import type { EventPayload } from "@/features/documents/contracts/stream-events";
import type { Extraction } from "@/server/ai/extraction";
import type { TemplateAnalysis } from "@/server/fields/template-analysis";
import { setModelForTests } from "@/server/ai/model";
import { chatTurn, correctField, ruleAction, setConversationLanguage } from "@/server/documents/answers";
import { compare } from "@/server/documents/comparison";
import { generateDraft, readDocx, saveEditorDocx } from "@/server/documents/drafting";
import { copyDraft, deleteDraft, listDrafts, renameDraft } from "@/server/documents/drafts";
import { createFromUpload } from "@/server/documents/upload";
import { currentView, getView } from "@/server/documents/views";
import { NotFound } from "@/server/http/responses";
import { BrokenStore, MemoryStore, mockModel } from "../helpers";

const lease = new Uint8Array(readFileSync("fixtures/synthetic-bilingual-lease.docx"));
const employment = new Uint8Array(readFileSync("fixtures/synthetic-bilingual-employment.docx"));

type AF = TemplateAnalysis["fields"][number];
const f = (id: string, label: string, valueType: AF["valueType"], group: AF["group"], markerKeys: string[], question: string, questionFr: string): AF => ({
  id,
  label,
  question,
  questionFr,
  valueType,
  group,
  required: true,
  markerKeys,
  implicit: [],
});

/** What a correct analysis of the bilingual lease looks like: English and French occurrences of the same value grouped. */
const LEASE_ANALYSIS: TemplateAnalysis = {
  notFields: [],
  fields: [
    f("landlord_name", "Landlord / Bailleur", "party", "parties", ["k:landlord name", "k:nom du bailleur"], "Who is the landlord?", "Qui est le bailleur ?"),
    f("tenant_name", "Tenant / Locataire", "party", "parties", ["k:tenant name", "k:nom du locataire"], "Who is the tenant?", "Qui est le locataire ?"),
    f(
      "property_address",
      "Property address / Adresse du bien",
      "address",
      "subject",
      ["k:property address", "k:adresse du bien"],
      "What is the property address?",
      "Quelle est l'adresse du bien ?",
    ),
    f(
      "start_date",
      "Start date / Date de début",
      "date",
      "dates",
      ["k:start date", "k:date de debut"],
      "When does the lease start?",
      "Quand le bail commence-t-il ?",
    ),
    f(
      "term_months",
      "Term in months / Durée en mois",
      "number",
      "dates",
      ["k:number of months", "k:nombre de mois"],
      "For how many months?",
      "Pour combien de mois ?",
    ),
    f(
      "monthly_rent",
      "Monthly rent / Loyer mensuel",
      "money",
      "money",
      ["k:monthly rent", "k:loyer mensuel"],
      "What is the monthly rent?",
      "Quel est le loyer mensuel ?",
    ),
    f("deposit", "Deposit / Dépôt de garantie", "money", "money", ["k:deposit"], "How much is the deposit?", "Quel est le montant du dépôt de garantie ?"),
    f(
      "reference",
      "Reference",
      "text",
      "other",
      ["k:reference number"],
      "What reference should appear in the header?",
      "Quelle référence doit figurer en en-tête ?",
    ),
  ],
};

type Turn = { updates: Extraction["updates"]; clauseBlockIds?: string[] };
let nextTurn: Turn = { updates: [] };
let analysis: TemplateAnalysis = LEASE_ANALYSIS;
const calls = { generate: 0, stream: 0 };
let lastReplyPrompt = "";

const model = mockModel({
  object: (prompt) => {
    calls.generate++;
    if (prompt.includes("MARKERS (key")) return analysis;
    return { clauseBlockIds: [], ...nextTurn } satisfies Extraction;
  },
  reply: (prompt) => {
    calls.stream++;
    lastReplyPrompt = prompt;
    return "Merci. Réponse suivante ?";
  },
});

const u = (fieldId: string, value: string, evidence = value, currency: string | null = null) => ({ fieldId, value, evidence, currency });

let pool: pg.Pool;
let store: MemoryStore;

async function newSession() {
  const id = await repo.createSession(`test-${crypto.randomUUID()}`);
  return { id, aiRequests: 0, aiInputTokens: 0, aiOutputTokens: 0 };
}

async function collect(run: (emit: (e: EventPayload) => void, signal: AbortSignal) => Promise<void>) {
  const events: EventPayload[] = [];
  await run((e) => events.push(e), new AbortController().signal);
  return events;
}

async function say(session: Awaited<ReturnType<typeof newSession>>, docId: string, message: string, turn: Turn) {
  nextTurn = turn;
  const doc = await getView(session.id, docId);
  return collect((emit, signal) => chatTurn(session, docId, { message, fieldsVersion: doc.fieldsVersion }, emit, signal));
}

const bodyText = async (bytes: Uint8Array | Buffer) => (await indexBlocks(await loadDocxPackage(new Uint8Array(bytes)))).map((b) => b.text).join("\n");
const generate = async (sid: string, docId: string) => {
  const v = await getView(sid, docId);
  return collect((e, sig) => generateDraft(sid, docId, { fieldsVersion: v.fieldsVersion }, e, sig));
};

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
  analysis = LEASE_ANALYSIS;
});

describe("French and bilingual templates", () => {
  it("groups EN/FR occurrences, accepts French answers, renders each occurrence in its language and keeps clause wording", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "bail.docx", lease);
    expect(d.language.document).toBe("mixed");
    expect(
      d.fields
        .find((x) => x.id === "tenant_name")!
        .occurrences.map((o) => o.lang)
        .sort(),
    ).toEqual(["en", "fr"]);

    const msg = "Le locataire est Hélène Dupré-Lefèvre, le bail commence le 1er octobre 2026 et le loyer est de 1 250,50 EUR par mois.";
    await say(s, d.id, msg, {
      updates: [u("tenant_name", "Hélène Dupré-Lefèvre"), u("start_date", "1er octobre 2026"), u("monthly_rent", "1 250,50 EUR", "1 250,50 EUR")],
    });
    const v = await getView(s.id, d.id);
    expect(v.fields.find((x) => x.id === "monthly_rent")).toMatchObject({
      status: "confirmed",
      normalized: { kind: "money", amount: "1250.50", currency: "EUR" },
    });
    expect(v.fields.find((x) => x.id === "start_date")!.normalized).toEqual({ kind: "date", iso: "2026-10-01" });
    expect(v.language.effective).toBe("fr");
    expect(lastReplyPrompt).toContain("REPLY LANGUAGE: French");
    expect(lastReplyPrompt).toContain("Qui est le bailleur ?"); // the next question, in French

    // Switching to English: deterministic confirmation, no model call, nothing re-asked or lost.
    const before = { ...calls };
    const en = await setConversationLanguage(s.id, d.id, { fieldsVersion: v.fieldsVersion, language: "en" });
    expect(calls).toEqual(before);
    expect(en.messages.at(-1)!.content).toMatch(/continue in English.*3 confirmed answers are kept/);
    expect(en.fields.filter((x) => x.status === "confirmed")).toHaveLength(3);
    await say(s, en.id, "The landlord is Ravi Ramdin, property 4 Sea View Lane, 12 months, deposit EUR 2,500, ref LX-9", {
      updates: [
        u("landlord_name", "Ravi Ramdin"),
        u("property_address", "4 Sea View Lane"),
        u("term_months", "12"),
        u("deposit", "EUR 2,500"),
        u("reference", "LX-9"),
      ],
    });
    expect(lastReplyPrompt).toContain("REPLY LANGUAGE: English");

    expect((await generate(s.id, d.id)).at(-1)!.type).toBe("draft_complete");
    const text = await bodyText((await readDocx(s.id, d.id, "working")).bytes);
    expect(text.match(/Hélène Dupré-Lefèvre/g)).toHaveLength(2);
    expect(text).toContain("The lease commences on 1 October 2026");
    expect(text).toContain("Le bail prend effet le 1 octobre 2026");
    expect(text).toContain("The monthly rent is EUR 1,250.50");
    expect(text).toContain("Le loyer mensuel est de 1 250,50 EUR");
    expect(text).toContain("Le Bailleur donne à bail au Locataire le bien situé 4 Sea View Lane"); // clause wording untouched
  });

  it("asks about an ambiguous separator instead of guessing, and never infers a currency from the language", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "bail.docx", lease);
    await say(s, d.id, "Le loyer est de 25,000", { updates: [u("monthly_rent", "25,000")] });
    const rent = (await getView(s.id, d.id)).fields.find((x) => x.id === "monthly_rent")!;
    expect(rent.status).toBe("needs_clarification");
  });
});

describe("conditional clauses", () => {
  const EMPLOYMENT: TemplateAnalysis = {
    notFields: [],
    fields: [],
    conditions: [
      {
        name: "employee_is_senior",
        question: "Is the employee classified as senior for this agreement?",
        questionFr: "Le salarié est-il classé cadre dirigeant pour ce contrat ?",
      },
    ],
  };

  async function setup() {
    analysis = EMPLOYMENT;
    const s = await newSession();
    const d = await createFromUpload(s, "employment.docx", employment);
    return { s, d };
  }

  async function fillAllExcept(sid: string, docId: string, skip: (id: string) => boolean) {
    for (;;) {
      const v = await getView(sid, docId);
      const next = v.fields.find((x) => x.status !== "confirmed" && x.source !== "condition" && !skip(x.id));
      if (!next) return v;
      await correctField(sid, docId, {
        fieldsVersion: v.fieldsVersion,
        fieldId: next.id,
        value:
          next.valueType === "date"
            ? "1 October 2026"
            : next.valueType === "money"
              ? "EUR 1,250.50"
              : next.valueType === "duration"
                ? "12 months"
                : `V ${next.id}`,
      });
    }
  }

  it("unknown blocks the draft; yes includes; no excludes; back to yes restores once; exclusive fields stop blocking", async () => {
    const { s, d } = await setup();
    expect(d.rules).toMatchObject([{ id: "clause_employee_is_senior", state: "unresolved", source: "marker" }]);
    expect(d.fields.find((x) => x.id === "employee_is_senior")!.question).toBe("Is the employee classified as senior for this agreement?");
    await fillAllExcept(s.id, d.id, (id) =>
      [
        "non_compete_period",
        "restricted_area",
        "zone_geographique",
        "duree_de_non_concurrence",
        "non_compete_indemnity",
        "indemnite_de_non_concurrence",
      ].includes(id),
    );
    expect(await generate(s.id, d.id)).toEqual([
      expect.objectContaining({ type: "error", code: "incomplete", message: expect.stringMatching(/Employee is senior.*decision for “Non-competition”/) }),
    ]);

    // "No": the clause's own fields no longer block completion.
    await say(s, d.id, "non", { updates: [u("employee_is_senior", "no", "non")] });
    let v = await getView(s.id, d.id);
    expect(v.rules[0]).toMatchObject({ state: "excluded", reason: "Employee is senior = No" });
    expect(v.phase).toBe("ready");
    expect((await generate(s.id, d.id)).at(-1)!.type).toBe("draft_complete");
    let text = await bodyText((await readDocx(s.id, d.id, "working")).bytes);
    expect(text).not.toContain("Non-competition");
    expect(text).not.toMatch(/\[\[/);

    // "Yes" after drafting: the clause comes back (from the template), exactly once.
    const ev = await say(s, d.id, "Actually yes, he is senior", { updates: [u("employee_is_senior", "yes", "yes")] });
    expect(ev.find((e) => e.type === "draft_patch")).toMatchObject({ clauseChanges: [{ action: "include" }] });
    text = await bodyText((await readDocx(s.id, d.id, "working")).bytes);
    expect(text.match(/Non-competition/g)).toHaveLength(1);
    v = await getView(s.id, d.id);
    expect(v.inactiveFieldIds).not.toContain("restricted_area");
    expect(v.rules[0]!.applied).toBe("included");

    // An explicit override is persisted and visible, and wins over the condition.
    v = await ruleAction(s.id, d.id, { fieldsVersion: v.fieldsVersion, ruleId: "clause_employee_is_senior", action: "exclude" });
    expect(v.rules[0]).toMatchObject({ override: "exclude", state: "excluded", applied: "excluded" });
    v = await ruleAction(s.id, d.id, { fieldsVersion: v.fieldsVersion, ruleId: "clause_employee_is_senior", action: "clear_override" });
    expect(v.rules[0]).toMatchObject({ override: null, state: "included", applied: "included" });
    expect((await bodyText((await readDocx(s.id, d.id, "working")).bytes)).match(/Non-competition/g)).toHaveLength(1);
  });

  it("asks before removing a clause edited in the browser, then removes it and brings the edit back on re-include", async () => {
    const { s, d } = await setup();
    await say(s, d.id, "oui", { updates: [u("employee_is_senior", "yes", "oui")] });
    await fillAllExcept(s.id, d.id, () => false);
    await generate(s.id, d.id);
    const w = await readDocx(s.id, d.id, "working");
    const pkg = await loadDocxPackage(new Uint8Array(w.bytes));
    const b = (await indexBlocks(pkg)).find((x) => x.text.startsWith("For "))!;
    await applyTextEdits(pkg, [{ blockId: b.id, start: b.text.length, end: b.text.length, expected: "", value: " [lawyer's note]" }]);
    await saveEditorDocx(s.id, d.id, w.workingRevision, await serializePackage(pkg));

    const ev = await say(s, d.id, "non finalement", { updates: [u("employee_is_senior", "no", "non")] });
    expect(ev.find((e) => e.type === "draft_patch")).toMatchObject({ needsConfirmation: [{ ruleId: "clause_employee_is_senior" }] });
    let v = await getView(s.id, d.id);
    expect(v.rules[0]).toMatchObject({ pending: true, applied: "included" });
    expect(await bodyText((await readDocx(s.id, d.id, "working")).bytes)).toContain("[lawyer's note]");

    v = await ruleAction(s.id, d.id, { fieldsVersion: v.fieldsVersion, ruleId: "clause_employee_is_senior", action: "apply" });
    expect(v.rules[0]).toMatchObject({ pending: false, applied: "excluded", hasEditedVariant: true });
    expect(await bodyText((await readDocx(s.id, d.id, "working")).bytes)).not.toContain("[lawyer's note]");

    await say(s, d.id, "oui", { updates: [u("employee_is_senior", "yes", "oui")] });
    const text = await bodyText((await readDocx(s.id, d.id, "working")).bytes);
    expect(text.match(/\[lawyer's note\]/g)).toHaveLength(1);
  });
});

describe("saved drafts", () => {
  it("lists, renames, copies and deletes only this browser's drafts; another identity sees nothing", async () => {
    const a = await newSession();
    const b = await newSession();
    const d1 = await createFromUpload(a, "Bail Dupont.docx", lease);
    const d2 = await createFromUpload(a, "employment.docx", employment);
    expect((await listDrafts(a.id)).map((x) => x.id).sort()).toEqual([d1.id, d2.id].sort());
    expect(await listDrafts(b.id)).toEqual([]);
    expect((await renameDraft(a.id, d1.id, "  Dupont lease  ")).title).toBe("Dupont lease");
    for (const attempt of [
      () => getView(b.id, d1.id),
      () => renameDraft(b.id, d1.id, "x"),
      () => deleteDraft(b.id, d1.id),
      () => compare(b.id, d1.id, null),
      () => copyDraft(b.id, d1.id, null),
      () => ruleAction(b.id, d2.id, { fieldsVersion: 1, ruleId: "clause_employee_is_senior", action: "include" }),
      () => setConversationLanguage(b.id, d1.id, { fieldsVersion: 1, language: "fr" }),
      () => readDocx(b.id, d1.id, "original"),
    ])
      await expect(attempt()).rejects.toBeInstanceOf(NotFound);

    const copy = await copyDraft(a.id, d1.id, null);
    expect(copy.title).toBe("Dupont lease (copy)");
    expect(copy.messages.map((m) => m.content)).toEqual(d1.messages.map((m) => m.content));
    await deleteDraft(a.id, d1.id);
    await expect(getView(a.id, d1.id)).rejects.toBeInstanceOf(NotFound);
    // The copy still uses the lease template, so its cached analysis is kept; deleting its last user drops it.
    const cached = (hash: string) => [...store.data.keys()].filter((k) => k.startsWith(`lx:analysis:${a.id}:${hash}`)).length;
    const leaseHash = (await repo.getDocument(a.id, copy.id))!.templateHash;
    expect(cached(leaseHash)).toBe(1);
    await deleteDraft(a.id, copy.id);
    expect(cached(leaseHash)).toBe(0);
    await deleteDraft(a.id, d2.id);
  });

  it("resumes without any model call, duplicate message or regeneration; loading, listing and comparing are model-free", async () => {
    const s = await newSession();
    const d = await createFromUpload(s, "bail.docx", lease);
    await say(s, d.id, "Tenant is Jane Doe", { updates: [u("tenant_name", "Jane Doe")] });
    const before = { ...calls };
    const r1 = await getView(s.id, d.id);
    const r2 = await currentView(s.id);
    await listDrafts(s.id);
    await compare(s.id, d.id, null);
    expect(calls).toEqual(before);
    expect(r2!.messages).toEqual(r1.messages);
    expect(r1.fields.find((x) => x.id === "tenant_name")!.displayValue).toBe("Jane Doe");
  });

  it("detects an interrupted generation, rejects a stale second-tab save, compares unsaved content, and never serves expired drafts", async () => {
    analysis = { notFields: [], fields: [] };
    const s = await newSession();
    const d = await createFromUpload(s, "lease.docx", lease);
    await pool.query("UPDATE documents SET draft_status = 'generating', updated_at = now() - interval '5 minutes' WHERE id = $1", [d.id]);
    expect((await getView(s.id, d.id)).phase).toBe("interrupted");
    await pool.query("UPDATE documents SET draft_status = 'none' WHERE id = $1", [d.id]);

    for (const field of (await getView(s.id, d.id)).fields) {
      const v = await getView(s.id, d.id);
      await correctField(s.id, d.id, {
        fieldsVersion: v.fieldsVersion,
        fieldId: field.id,
        value: field.valueType === "date" ? "1 October 2026" : field.valueType === "money" ? "EUR 100" : "X",
      });
    }
    const before = { ...calls };
    expect((await generate(s.id, d.id)).at(-1)!.type).toBe("draft_complete");
    const w = await readDocx(s.id, d.id, "working");
    const saved = await saveEditorDocx(s.id, d.id, w.workingRevision, new Uint8Array(w.bytes));
    expect(saved.workingRevision).toBe(w.workingRevision + 1);
    // A second tab still holding the old revision cannot overwrite the newer save.
    await expect(saveEditorDocx(s.id, d.id, w.workingRevision, new Uint8Array(w.bytes))).rejects.toBeInstanceOf(repo.StaleRevisionError);

    // Unsaved editor content can be compared without being saved.
    const pkg = await loadDocxPackage(new Uint8Array(w.bytes));
    const blk = (await indexBlocks(pkg)).find((x) => x.text.startsWith("The monthly rent"))!;
    await applyTextEdits(pkg, [{ blockId: blk.id, start: blk.text.length, end: blk.text.length, expected: "", value: " UNSAVED EDIT" }]);
    const cmp = await compare(s.id, d.id, await serializePackage(pkg));
    expect(cmp.source).toBe("editor");
    expect(cmp.result.items.some((i) => i.segments.some((x) => x.op === "ins" && x.text.includes("UNSAVED EDIT")))).toBe(true);
    expect((await readDocx(s.id, d.id, "working")).workingRevision).toBe(saved.workingRevision);
    expect(calls).toEqual(before); // drafting, saving and comparing never call the model

    await pool.query("UPDATE documents SET expires_at = now() - interval '1 minute' WHERE id = $1", [d.id]);
    await expect(getView(s.id, d.id)).rejects.toBeInstanceOf(NotFound);
    expect(await listDrafts(s.id)).toEqual([]);
    const cleaned = await repo.deleteExpired(10);
    expect(cleaned.documents.map((x) => x.id)).toContain(d.id);
  });

  it("keeps working when the cache is down", async () => {
    setStoreForTests(new BrokenStore());
    const s = await newSession();
    const d = await createFromUpload(s, "bail.docx", lease);
    expect((await listDrafts(s.id)).length).toBe(1);
    expect((await compare(s.id, d.id, null)).source).toBe("preview");
    await deleteDraft(s.id, d.id);
  });
});

describe("Word content controls", () => {
  it("writes a chat answer given after drafting into its placeholder box, which then stops being a placeholder", async () => {
    analysis = { notFields: [], fields: [] }; // every placeholder box becomes its own field
    const s = await newSession();
    let d = await createFromUpload(s, "lettre.docx", new Uint8Array(readFileSync("fixtures/synthetic-lettre-controles-fr.docx")));
    const titre = d.fields.find((x) => x.label === "Titre")!;
    for (const field of d.fields) {
      d = await correctField(
        s.id,
        d.id,
        field.id === titre.id
          ? { fieldsVersion: d.fieldsVersion, fieldId: field.id, required: false }
          : { fieldsVersion: d.fieldsVersion, fieldId: field.id, value: field.valueType === "date" ? "24 septembre 2026" : `Valeur ${field.id}` },
      );
    }
    expect((await generate(s.id, d.id)).some((e) => e.type === "draft_complete")).toBe(true);
    expect(await bodyText((await readDocx(s.id, d.id, "working")).bytes)).toContain("Titre"); // still the placeholder

    const events = await say(s, d.id, "Le titre est Responsable des sinistres.", { updates: [u(titre.id, "Responsable des sinistres")] });
    expect(events.find((e) => e.type === "draft_patch")).toMatchObject({ applied: [titre.id], conflicts: [] });
    const working = (await readDocx(s.id, d.id, "working")).bytes;
    const lines = (await bodyText(working)).split("\n");
    expect(lines).toContain("Responsable des sinistres");
    expect(lines).not.toContain("Titre");
    const xml = await (await JSZip.loadAsync(working)).file("word/document.xml")!.async("string");
    const at = xml.indexOf("Responsable des sinistres");
    expect(xml.slice(xml.lastIndexOf("<w:sdt>", at), at)).not.toContain("showingPlcHdr");
  });
});
