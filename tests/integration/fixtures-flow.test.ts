process.env.DATABASE_URL ??=
  "postgres://postgres:postgres@localhost:5432/lumetryx_test";

import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Field } from "@/features/documents/contracts/fields";
import type { EventPayload } from "@/features/documents/contracts/stream-events";
import { variantLangs } from "@/features/documents/progress";
import type { Extraction } from "@/server/ai/extraction";
import { setModelForTests } from "@/server/ai/model";
import { setStoreForTests } from "@/server/cache/redis";
import { createSession } from "@/server/db/sessions";
import { chatTurn, correctField } from "@/server/documents/answers";
import {
  generateDraft,
  readDocx,
  saveEditorDocx,
} from "@/server/documents/drafting";
import { exportCheck } from "@/server/documents/export-check";
import { createFromUpload } from "@/server/documents/upload";
import { currentView, getView } from "@/server/documents/views";
import type { RenderedBlock } from "@/server/docx/blocks";
import { loadDocxPackage, serializePackage } from "@/server/docx/package";
import { applyTextEdits, indexBlocks } from "@/server/docx/render";
import { renderAt } from "@/server/fields/normalize";
import { TemplateAnalysis } from "@/server/fields/template-analysis";
import { MemoryStore, mockModel } from "../helpers";
import { loadManifest, score, type Manifest } from "../manifest-score";

type Update = Extraction["updates"][number];

let analysis: TemplateAnalysis = {
  notFields: [],
  fields: [],
};
let nextUpdates: Update[] = [];
let lastReplyPrompt = "";

const model = mockModel({
  object: (prompt) => {
    if (prompt.includes("MARKERS (key")) {
      return analysis;
    }

    return {
      clauseBlockIds: [],
      updates: nextUpdates,
    } satisfies Extraction;
  },
  reply: (prompt) => {
    lastReplyPrompt = prompt;

    return "Thanks, that is noted. What should come next?";
  },
});

let pool: pg.Pool;

const recorded = (name: string) => {
  const raw: { analysis: unknown } = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, `../recorded/${name}.analysis.json`),
      "utf8",
    ),
  );

  return TemplateAnalysis.parse(raw.analysis);
};

async function newSession() {
  return {
    id: await createSession(`flow-${crypto.randomUUID()}`),
    aiRequests: 0,
    aiInputTokens: 0,
    aiOutputTokens: 0,
  };
}

type Session = Awaited<ReturnType<typeof newSession>>;

async function collect(
  run: (emit: (e: EventPayload) => void, signal: AbortSignal) => Promise<void>,
) {
  const events: EventPayload[] = [];

  await run((e) => events.push(e), new AbortController().signal);

  return events;
}

async function say(
  s: Session,
  docId: string,
  message: string,
  updates: Update[],
) {
  nextUpdates = updates;
  const doc = await getView(s.id, docId);

  return collect((emit, signal) =>
    chatTurn(
      s,
      docId,
      {
        message,
        fieldsVersion: doc.fieldsVersion,
      },
      emit,
      signal,
    ),
  );
}

const up = (
  fieldId: string,
  value: string,
  evidence = value,
  extra: Partial<Update> = {},
): Update => {
  return {
    fieldId,
    value,
    evidence,
    currency: null,
    ...extra,
  };
};

const FILLER: Record<string, string> = {
  email: "notices@example.com",
  number: "7",
  duration: "7",
  percentage: "5",
  date: "1 October 2026",
  money: "EUR 500",
  currency: "EUR",
  party: "Sample Party Ltd",
  address: "10 Sample Road, Port Louis",
  boolean: "yes",
};

async function fillRest(s: Session, docId: string) {
  let view = await getView(s.id, docId);
  let day = 10;

  for (const f of view.fields) {
    if (f.status === "confirmed") {
      continue;
    }

    const langs = variantLangs(f);

    if (langs.length) {
      for (const lang of langs) {
        view = await correctField(s.id, docId, {
          fieldsVersion: view.fieldsVersion,
          fieldId: f.id,
          value: lang === "fr" ? "Texte d’exemple" : "Sample text",
          lang,
        });
      }

      continue;
    }

    view = await correctField(s.id, docId, {
      fieldsVersion: view.fieldsVersion,
      fieldId: f.id,
      value:
        f.valueType === "date"
          ? `${day++} November 2026`
          : (FILLER[f.valueType] ?? `Sample ${f.label}`),
    });
  }

  return view;
}

const blocksOf = async (bytes: Uint8Array | Buffer) => {
  return indexBlocks(await loadDocxPackage(new Uint8Array(bytes)));
};

function expectedText(
  block: RenderedBlock,
  fields: Field[],
  docLang: "en" | "fr" | "mixed",
) {
  const edits = fields
    .flatMap((f) =>
      f.occurrences
        .filter((o) => o.blockId === block.id)
        .map((o) => {
          const v = renderAt(f, o.lang, docLang);
          const value =
            v === null
              ? o.expected
              : o.mode === "insert" && o.start > 0
                ? ` ${v}`
                : v;

          return {
            start: o.start,
            end: o.end,
            value,
          };
        }),
    )
    .sort((a, b) => b.start - a.start);

  return edits.reduce(
    (text, e) => text.slice(0, e.start) + e.value + text.slice(e.end),
    block.text,
  );
}

async function expectFaithfulExport(
  template: Uint8Array,
  exported: Uint8Array,
  fields: Field[],
  docLang: "en" | "fr" | "mixed",
  edited: ReadonlyMap<string, string>,
) {
  const before = await blocksOf(template);
  const after = await blocksOf(exported);

  expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));

  for (const [i, t] of before.entries()) {
    const e = after[i];

    expect(e?.styleId, t.id).toBe(t.styleId);
    expect(e?.numbering, t.id).toEqual(t.numbering);
    expect(e?.table, t.id).toEqual(t.table);

    expect(e?.text, t.id).toBe(
      edited.get(t.id) ?? expectedText(t, fields, docLang),
    );

    const touched =
      edited.has(t.id) ||
      fields.some((f) => f.occurrences.some((o) => o.blockId === t.id));

    if (!touched) {
      expect(e?.runs, t.id).toEqual(t.runs);
    } else if (t.runs.length && t.runs.every((r) => r.italic)) {
      expect(
        e?.runs.every((r) => r.italic || !r.text.trim()),
        t.id,
      ).toBe(true);
    }
  }

  const a = await JSZip.loadAsync(template);
  const b = await JSZip.loadAsync(exported);

  for (const part of [
    "word/styles.xml",
    "word/numbering.xml",
    "word/settings.xml",
    "word/theme/theme1.xml",
    "word/fontTable.xml",
    "word/_rels/document.xml.rels",
  ]) {
    expect(await b.file(part)?.async("string"), part).toBe(
      await a.file(part)?.async("string"),
    );
  }
}

async function browserEdit(
  bytes: Buffer,
  blockId: string,
  suffix: string,
): Promise<{
  bytes: Uint8Array;
  text: string;
}> {
  const pkg = await loadDocxPackage(new Uint8Array(bytes));
  const block = (await indexBlocks(pkg)).find((b) => b.id === blockId);

  if (!block) {
    throw new Error(blockId);
  }

  await applyTextEdits(pkg, [
    {
      blockId,
      start: block.text.length,
      end: block.text.length,
      expected: "",
      value: suffix,
    },
  ]);

  return {
    bytes: await serializePackage(pkg),
    text: block.text + suffix,
  };
}

interface Script {
  name: string;
  docLang: "en" | "fr" | "mixed";
  staticBlock: string;
  turns: (id: (x: string) => string) => {
    message: string;
    updates: Update[];
    check: (fields: Field[], events: EventPayload[]) => void;
  }[];
  afterDraft: (id: (x: string) => string) => {
    message: string;
    updates: Update[];
    field: string;
    expectInDoc: string;
  };
}

const find = (fields: Field[], id: string) => {
  const f = fields.find((x) => x.id === id);

  if (!f) {
    throw new Error(id);
  }

  return f;
};

const SCRIPTS: Script[] = [
  {
    name: "01_Mutual_NDA",
    docLang: "en",
    staticBlock: "word/document.xml#32",
    turns: (id) => [
      {
        message:
          "Party A is Acme Holdings Ltd., 1 Main Street, Port Louis. Party B is Beta Conseil SARL of 4 Rue de la Paix, Paris.",
        updates: [
          up(id("party_a_name"), "Acme Holdings Ltd."),
          up(id("party_a_address"), "1 Main Street, Port Louis"),
          up(id("party_b_name"), "Beta Conseil SARL"),
          up(id("party_b_address"), "4 Rue de la Paix, Paris"),
        ],
        check: (fields, events) => {
          expect(find(fields, id("party_a_name")).displayValue).toBe(
            "Acme Holdings Ltd.",
          );

          expect(find(fields, id("party_b_name")).displayValue).toBe(
            "Beta Conseil SARL",
          );

          expect(
            events.filter((e) => e.type === "assistant_delta").length,
          ).toBeGreaterThan(1);
        },
      },
      {
        message:
          "It takes effect on 03/04/2026. Jane Doe is Party A's contact; her email is jane.doe@acme.example.",
        updates: [
          up(id("effective_date"), "03/04/2026"),
          up(
            id("party_a_contact"),
            "Jane Doe",
            "Jane Doe is Party A's contact",
          ),
          up(
            id("party_a_signatory_name"),
            "Jane Doe",
            "Jane Doe is Party A's contact",
          ),
          up(id("party_a_email"), "jane.doe@acme.example"),
        ],
        check: (fields) => {
          expect(find(fields, id("effective_date")).issue?.code).toBe(
            "ambiguous_date",
          );

          expect(find(fields, id("party_a_contact")).status).toBe("confirmed");

          expect(find(fields, id("party_a_signatory_name")).status).toBe(
            "missing",
          );

          expect(find(fields, id("party_a_email")).displayValue).toBe(
            "jane.doe@acme.example",
          );

          expect(lastReplyPrompt).toMatch(
            /NEEDS CLARIFICATION: [^\n]*Effective/i,
          );
        },
      },
      {
        message:
          "I meant 3 April 2026. The purpose is a joint venture in solar storage, the project is Project Helios, and materials go back within 30 calendar days.",
        updates: [
          up(id("effective_date"), "3 April 2026"),
          up(id("purpose"), "a joint venture in solar storage"),
          up(id("project_name"), "Project Helios"),
          up(id("return_period_days"), "30 calendar days", "30 calendar days"),
        ],
        check: (fields) => {
          expect(find(fields, id("effective_date")).normalized).toEqual({
            kind: "date",
            iso: "2026-04-03",
          });

          expect(find(fields, id("purpose")).displayValue).toBe(
            "a joint venture in solar storage",
          );

          expect(find(fields, id("project_name")).displayValue).toBe(
            "Project Helios",
          );

          expect(find(fields, id("return_period_days")).displayValue).toBe(
            "30",
          );
        },
      },
      {
        message: "Actually the project is called Project Helios II.",
        updates: [up(id("project_name"), "Project Helios II")],
        check: (fields) => {
          expect(find(fields, id("project_name")).displayValue).toBe(
            "Project Helios II",
          );

          expect(find(fields, id("purpose")).displayValue).toBe(
            "a joint venture in solar storage",
          );
        },
      },
    ],
    afterDraft: (id) => ({
      message: "Change the agreement reference to NDA-2026-77.",
      updates: [up(id("agreement_reference"), "NDA-2026-77")],
      field: id("agreement_reference"),
      expectInDoc: "NDA-2026-77",
    }),
  },
  {
    name: "02_Residential_Lease_Mixed_Placeholders",
    docLang: "en",
    staticBlock: "word/document.xml#35",
    turns: (id) => [
      {
        message:
          "The landlord is Paul Martin of 12 Royal Road, Curepipe. The tenant is Mary Major, currently of 8 Sea View Lane, Flic en Flac. The flat is at 3 Palm Court, Quatre Bornes.",
        updates: [
          up(id("landlord_name"), "Paul Martin"),
          up(id("landlord_address"), "12 Royal Road, Curepipe"),
          up(id("tenant_name"), "Mary Major"),
          up(id("tenant_address"), "8 Sea View Lane, Flic en Flac"),
          up(id("property_address"), "3 Palm Court, Quatre Bornes"),
        ],
        check: (fields) => {
          expect(find(fields, id("tenant_address")).displayValue).toBe(
            "8 Sea View Lane, Flic en Flac",
          );

          expect(find(fields, id("landlord_address")).displayValue).toBe(
            "12 Royal Road, Curepipe",
          );

          expect(find(fields, id("property_address")).displayValue).toBe(
            "3 Palm Court, Quatre Bornes",
          );
        },
      },
      {
        message:
          "Two persons in total, no additional occupants. Rent is $1,500 a month with a refundable deposit of $3,000, due on the 5th.",
        updates: [
          up(id("occupant_count"), "Two persons", "Two persons"),
          up(id("additional_occupants"), "", "no additional occupants", {
            resolution: "none",
          }),
          up(id("monthly_rent"), "$1,500"),
          up(id("deposit"), "$3,000"),
          up(id("rent_due_day"), "5th", "the 5th"),
        ],
        check: (fields) => {
          expect(find(fields, id("occupant_count")).displayValue).toBe("2");

          expect(find(fields, id("additional_occupants")).resolution).toBe(
            "none",
          );

          expect(find(fields, id("monthly_rent")).issue?.code).toBe(
            "ambiguous_currency",
          );

          expect(find(fields, id("rent_due_day")).status).toBe("confirmed");
        },
      },
      {
        message: "Those are US dollars, and the currency line should read USD.",
        updates: [
          up(id("monthly_rent"), "$1,500", "US dollars", { currency: "USD" }),
          up(id("deposit"), "$3,000", "US dollars", { currency: "USD" }),
          up(id("currency"), "USD"),
        ],
        check: (fields) => {
          expect(find(fields, id("monthly_rent")).normalized).toMatchObject({
            amount: "1500",
            currency: "USD",
          });

          expect(find(fields, id("deposit")).normalized).toMatchObject({
            amount: "3000",
            currency: "USD",
          });
        },
      },
      {
        message:
          "Visits need 24 hours notice, ending the tenancy needs 60 calendar days, and the internet is paid by the Tenant.",
        updates: [
          up(id("access_notice_hours"), "24 hours"),
          up(id("termination_notice_days"), "60 calendar days"),
          up(id("internet_payer"), "the Tenant", "paid by the Tenant"),
        ],
        check: (fields) => {
          expect(find(fields, id("access_notice_hours")).displayValue).toBe(
            "24",
          );

          expect(find(fields, id("termination_notice_days")).displayValue).toBe(
            "60",
          );
        },
      },
    ],
    afterDraft: (id) => ({
      message: "Correction: the property reference is PR-114B.",
      updates: [up(id("property_reference"), "PR-114B")],
      field: id("property_reference"),
      expectInDoc: "PR-114B",
    }),
  },
  {
    name: "03_Bilingual_Services_Agreement",
    docLang: "mixed",
    staticBlock: "word/document.xml#47",
    turns: (id) => [
      {
        message:
          "The provider is Studio Lumière SARL and the client is Blue Ocean Ltd. The project is Refonte du portail client.",
        updates: [
          up(id("provider_name"), "Studio Lumière SARL"),
          up(id("client_name"), "Blue Ocean Ltd"),
          up(id("project_title"), "Refonte du portail client"),
        ],
        check: (fields) => {
          expect(find(fields, id("provider_name")).displayValue).toBe(
            "Studio Lumière SARL",
          );
        },
      },
      {
        message:
          "The services are a website redesign and hosting for 12 months. The fee is 25 000,50 EUR with an advance of 5 000 EUR, payable within 30 days.",
        updates: [
          up(
            id("services_description"),
            "a website redesign and hosting for 12 months",
            "a website redesign and hosting for 12 months",
            {
              translation: {
                lang: "fr",
                value:
                  "une refonte du site web et un hébergement pendant 12 mois",
              },
            },
          ),
          up(id("total_fee"), "25 000,50 EUR"),
          up(id("advance_payment"), "5 000 EUR"),
          up(id("payment_deadline_days"), "30 days", "within 30 days"),
        ],
        check: (fields) => {
          const services = find(fields, id("services_description"));

          expect(services.status).toBe("confirmed");

          expect(services.variants.map((v) => v.lang).sort()).toEqual([
            "en",
            "fr",
          ]);

          expect(find(fields, id("total_fee")).normalized).toMatchObject({
            amount: "25000.50",
            currency: "EUR",
          });

          expect(find(fields, id("payment_deadline_days")).displayValue).toBe(
            "30",
          );
        },
      },
      {
        message:
          "Deliverable 1 is the design mock-ups, due 15/10/2026; deliverable 2 is the live website, due 1 December 2026. The client reviews within 10 business days.",
        updates: [
          up(id("deliverable_1"), "the design mock-ups"),
          up(id("delivery_date_1"), "15/10/2026"),
          up(id("deliverable_2"), "the live website"),
          up(id("delivery_date_2"), "1 December 2026"),
          up(id("review_days"), "10 business days"),
        ],
        check: (fields) => {
          expect(find(fields, id("delivery_date_1")).normalized).toEqual({
            kind: "date",
            iso: "2026-10-15",
          });

          expect(find(fields, id("delivery_date_2")).normalized).toEqual({
            kind: "date",
            iso: "2026-12-01",
          });

          expect(find(fields, id("review_days")).displayValue).toBe("10");
        },
      },
    ],
    afterDraft: (id) => ({
      message: "The billing email is now factures@blueocean.example.",
      updates: [up(id("billing_email"), "factures@blueocean.example")],
      field: id("billing_email"),
      expectInDoc: "factures@blueocean.example",
    }),
  },
];

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(
    "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;",
  );

  await migrate(drizzle({ client: pool }), { migrationsFolder: "drizzle" });
  setModelForTests(model);
});

afterAll(async () => {
  setModelForTests(undefined);
  await pool.end();
});

beforeEach(() => {
  setStoreForTests(new MemoryStore());
});

describe.each(SCRIPTS)("$name, from upload to a reparsed export", (script) => {
  it("answers, clarifies, corrects, drafts, keeps a browser edit, resumes and exports faithfully", async () => {
    const { manifest, bytes } = loadManifest(script.name);

    analysis = recorded(script.name);

    const s = await newSession();
    const uploaded = await createFromUpload(s, `${script.name}.docx`, bytes);
    const scored = score(manifest satisfies Manifest, uploaded.fields);

    expect(scored.missing).toEqual([]);
    expect(scored.merges).toEqual([]);

    const id = (x: string) => {
      const f = scored.matched.get(x);

      if (!f) {
        throw new Error(`no field for ${x}`);
      }

      return f.id;
    };

    for (const turn of script.turns(id)) {
      const events = await say(s, uploaded.id, turn.message, turn.updates);

      expect(events.at(-1)?.type).toBe("assistant_done");
      turn.check((await getView(s.id, uploaded.id)).fields, events);
    }

    const ready = await fillRest(s, uploaded.id);

    expect(
      ready.fields
        .filter((f) => f.required && f.status !== "confirmed")
        .map((f) => `${f.id}:${f.status}:${f.note ?? ""}`),
    ).toEqual([]);

    expect(ready.phase).toBe("ready");

    const draft = await collect((emit, signal) =>
      generateDraft(
        s.id,
        uploaded.id,
        { fieldsVersion: ready.fieldsVersion },
        emit,
        signal,
      ),
    );
    const types = draft.map((e) => e.type);

    expect(
      types.filter((t) => t === "draft_block_ready").length,
    ).toBeGreaterThan(10);

    expect(types.indexOf("draft_block_ready")).toBeLessThan(
      types.indexOf("draft_complete"),
    );

    const working = await readDocx(s.id, uploaded.id, "working");
    const edit = await browserEdit(
      working.bytes,
      script.staticBlock,
      " (reviewed)",
    );

    await saveEditorDocx(
      s.id,
      uploaded.id,
      working.workingRevision,
      edit.bytes,
    );

    const change = script.afterDraft(id);
    const patched = await say(s, uploaded.id, change.message, change.updates);

    expect(patched.find((e) => e.type === "draft_patch")).toMatchObject({
      applied: [change.field],
      conflicts: [],
    });

    const resumed = await currentView(s.id);

    expect(resumed?.id).toBe(uploaded.id);
    expect(resumed?.phase).toBe("draft");

    expect(resumed?.messages.length).toBeGreaterThan(
      script.turns(id).length * 2,
    );

    const exported = await readDocx(s.id, uploaded.id, "working");
    const after = await blocksOf(exported.bytes);
    const all = after.map((b) => b.text).join("\n");

    expect(all).toContain(change.expectInDoc);

    expect(after.find((b) => b.id === script.staticBlock)?.text).toBe(
      edit.text,
    );

    for (const e of manifest.fields.flatMap((f) => f.occurrences)) {
      if (e.marker && e.marker.length > 2) {
        expect(all, e.marker).not.toContain(e.marker);
      }
    }

    await expectFaithfulExport(
      bytes,
      new Uint8Array(exported.bytes),
      resumed?.fields ?? [],
      script.docLang,
      new Map([[script.staticBlock, edit.text]]),
    );

    const check = await exportCheck(s.id, uploaded.id);

    expect(check).toEqual({
      outstanding: [],
      unclear: [],
      leftBlank: [],
      placeholders: [],
    });
  });
});
