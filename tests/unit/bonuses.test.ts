/** Unit tests for the four bonuses' deterministic cores: language, conditional clauses, structure and diff. No database, no model. */
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { detectMarkers } from "@/server/docx/detect";
import { applyTextEdits, indexBlocks } from "@/server/docx/render";
import { ensureParaIds } from "@/server/docx/para-ids";
import type { RenderedBlock } from "@/server/docx/blocks";
import { loadDocxPackage, serializePackage } from "@/server/docx/package";
import { compareBlocks } from "@/server/diff/compare-blocks";
import { diffTokens } from "@/server/diff/token-diff";
import { renderDraft } from "@/server/draft/generate";
import { updateWorkingDraft } from "@/server/draft/update";
import { buildFields, guessType } from "@/server/fields/build-fields";
import { detectLanguage, documentLanguage, formatDate, formatMoney, messageLanguage, replyLanguage } from "@/server/fields/lang";
import { normalizeValue, parseDate, renderAt } from "@/server/fields/normalize";
import { parseConditionMarkers } from "@/server/clauses/condition-markers";
import { evaluateRule, inactiveFields, omittedBlocks } from "@/server/clauses/evaluation";
import type { Block } from "@/server/docx/blocks";
import type { Field } from "@/features/documents/contracts/fields";
import type { FieldState } from "@/server/fields/state";

const fixture = (name: string) => new Uint8Array(readFileSync(`fixtures/${name}.docx`));
const bodyText = async (bytes: Uint8Array) => (await indexBlocks(await loadDocxPackage(bytes))).filter((b) => b.partKind === "body").map((b) => b.text);
const block = (id: string, text: string, extra: Partial<Block> = {}): Block => ({
  id,
  part: "word/document.xml",
  partKind: "body",
  ordinal: 0,
  kind: "paragraph",
  styleId: null,
  numbering: null,
  table: null,
  text,
  paraId: null,
  ...extra,
});

async function stateFor(name: string): Promise<{ original: Uint8Array; state: FieldState }> {
  const original = fixture(name);
  const blocks = await indexBlocks(await loadDocxPackage(original));
  const b = buildFields(blocks, detectMarkers(blocks), null);
  const language = documentLanguage(blocks.filter((x) => x.partKind === "body").map((x) => x.text));
  return {
    original,
    state: {
      version: 2,
      fields: b.fields,
      draftAnchors: {},
      rules: b.rules,
      ruleIssues: b.ruleIssues,
      structureIssues: [],
      pendingClauses: [],
      references: [],
      language,
      conversationLanguage: null,
    },
  };
}

function answer(state: FieldState, id: string, value: string): FieldState {
  return {
    ...state,
    fields: state.fields.map((f) => (f.id === id ? { ...f, rawValue: value, ...normalizeValue(f.valueType, value, { lang: "en", currencyHint: "EUR" }) } : f)),
  };
}
const answerAll = (state: FieldState) =>
  state.fields.reduce(
    (s, f) =>
      f.status === "confirmed" || f.source === "condition"
        ? s
        : answer(
            s,
            f.id,
            f.valueType === "date" ? "1 October 2026" : f.valueType === "money" ? "EUR 1,250.50" : f.valueType === "duration" ? "12 months" : `Value ${f.id}`,
          ),
    state,
  );

describe("language", () => {
  it("detects English, French and unknown text, and a template's dominant language", () => {
    expect(detectLanguage("The Tenant shall pay the rent to the Landlord on the first day of each month.")).toBe("en");
    expect(detectLanguage("Le Locataire paie le loyer au Bailleur le premier jour de chaque mois.")).toBe("fr");
    expect(detectLanguage("Services")).toBe("unknown");
    expect(messageLanguage("oui")).toBe("fr");
    expect(documentLanguage(["The Tenant shall pay the rent to the Landlord monthly.", "Le Locataire paie le loyer au Bailleur chaque mois."]).document).toBe(
      "mixed",
    );
    expect(replyLanguage(null, "Le locataire est Jean Dupont", "en")).toBe("fr");
    expect(replyLanguage("en", "Le locataire est Jean Dupont", "fr")).toBe("en");
    expect(replyLanguage(null, "12", "fr")).toBe("fr");
  });

  it("parses French dates without timezone shifts and renders each occurrence in its language", () => {
    expect(parseDate("1er octobre 2026").normalized).toEqual({ kind: "date", iso: "2026-10-01" });
    expect(parseDate("le 15 août 2026").normalized).toEqual({ kind: "date", iso: "2026-08-15" });
    expect(parseDate("29 février 2027").status).toBe("needs_clarification");
    expect(parseDate("03/04/2026").status).toBe("needs_clarification");
    expect(formatDate("2026-10-01", "fr")).toBe("1 octobre 2026");
    expect(formatDate("2026-10-01", "en")).toBe("1 October 2026");
    expect(formatMoney("1250.50", "EUR", "fr")).toBe("1 250,50 EUR");
    const f = { status: "confirmed", displayValue: "1 October 2026", normalized: { kind: "date", iso: "2026-10-01" } } as Field;
    expect(renderAt(f, "fr", "mixed")).toBe("1 octobre 2026");
    expect(renderAt(f, "unknown", "fr")).toBe("1 octobre 2026");
    const name = { status: "confirmed", displayValue: "Hélène Dupré-Lefèvre", normalized: { kind: "text", value: "Hélène Dupré-Lefèvre" } } as Field;
    expect(renderAt(name, "fr", "mixed")).toBe("Hélène Dupré-Lefèvre");
  });

  it("finds accented French placeholders, including one split across runs, and never merges EN/FR markers by itself", async () => {
    const blocks = await indexBlocks(await loadDocxPackage(fixture("synthetic-contrat-prestation-fr")));
    const markers = detectMarkers(blocks);
    expect(markers.map((m) => m.text)).toEqual(
      expect.arrayContaining(["{{date_de_signature}}", "[NUMÉRO D’IMMATRICULATION]", "[adresse du prestataire]", "[date de début]", "[TAUX D’INTÉRÊT]"]),
    );
    const { fields } = buildFields(blocks, markers, null);
    expect(fields.find((f) => f.label === "Date de début")).toMatchObject({ valueType: "date" });
    expect(fields.find((f) => f.label === "Nom du prestataire")).toMatchObject({ valueType: "party" });
    expect(fields.every((f) => f.occurrences.every((o) => o.lang !== "en"))).toBe(true);
    const lease = await indexBlocks(await loadDocxPackage(fixture("synthetic-bilingual-lease")));
    const lf = buildFields(lease, detectMarkers(lease), null).fields;
    expect(lf.find((f) => f.id === "tenant_name")!.occurrences.map((o) => o.lang)).toEqual(["en"]);
    expect(lf.find((f) => f.id === "nom_du_locataire")!.occurrences.map((o) => o.lang)).toEqual(["fr"]);
    // Live Gemini echoes marker keys without their "k:" prefix; they must still resolve to the real markers.
    const grouped = buildFields(lease, detectMarkers(lease), {
      notFields: [],
      fields: [
        {
          id: "tenant_name",
          label: "Tenant",
          question: "?",
          questionFr: "?",
          valueType: "party",
          group: "parties",
          required: true,
          markerKeys: ["tenant name", "k:nom du locataire"],
          implicit: [],
        },
      ],
    });
    expect(grouped.rejected).toEqual([]);
    expect(
      grouped.fields
        .find((x) => x.id === "tenant_name")!
        .occurrences.map((o) => o.lang)
        .sort(),
    ).toEqual(["en", "fr"]);
    expect(grouped.fields.some((x) => x.id === "nom_du_locataire")).toBe(false);
    // "employer" must not be read as the French word "loyer" (rent).
    expect(guessType("Employer name").valueType).toBe("party");
  });
});

describe("conditional clause markers", () => {
  it("parses the documented grammar and rejects unpaired, nested, inline and table markers", () => {
    const blocks = [
      block("b#0", "[[IF employee_is_senior]]"),
      block("b#1", "Non-compete."),
      block("b#2", "[[END IF]]"),
      block("b#3", "[[SI NON prestataire_etranger]]"),
      block("b#4", "Clause française."),
      block("b#5", "[[FIN SI]]"),
      block("b#6", "[[IF plan IN gold, silver]]"),
      block("b#7", "Premium support."),
      block("b#8", "[[END IF]]"),
      block("b#9", "[[IF a]]"),
      block("b#10", "[[IF b]]"),
      block("b#11", "Inner."),
      block("b#12", "[[END IF]]"),
      block("b#13", "[[END IF]]"),
      block("b#14", "Text with [[IF inline]] marker."),
      block("b#15", "[[END IF]]"),
      block("t#0", "[[IF x]]", { table: { table: 0, row: 0, col: 0 }, kind: "tableCell" }),
    ];
    const r = parseConditionMarkers(blocks);
    expect(r.rules.map((x) => [x.condition.fieldId, x.condition.op, x.blockIds])).toEqual([
      ["employee_is_senior", "is_true", ["b#1"]],
      ["prestataire_etranger", "is_false", ["b#4"]],
      ["plan", "in", ["b#7"]],
    ]);
    expect(r.rules[2]!.condition.values).toEqual(["gold", "silver"]);
    expect(r.conditionFields.find((f) => f.id === "plan")?.valueType).toBe("text");
    expect(r.issues.join("\n")).toMatch(/nested conditions are not supported/);
    expect(r.issues.join("\n")).toMatch(/own line/);
    expect(r.issues.join("\n")).toMatch(/no matching \[\[IF/);
    expect(r.issues.join("\n")).toMatch(/not in tables/);
  });

  it("evaluates yes / no / unknown deterministically; unknown is never treated as no", async () => {
    let { state } = await stateFor("synthetic-bilingual-employment");
    const rule = state.rules[0]!;
    expect(evaluateRule(rule, state.fields).state).toBe("unresolved");
    expect(omittedBlocks(state).size).toBeGreaterThan(rule.blockIds.length); // undecided content is not drafted
    const exclusive = ["non_compete_period", "restricted_area", "zone_geographique"];
    for (const id of exclusive) expect(inactiveFields(state).has(id)).toBe(true);
    state = answer(state, "employee_is_senior", "maybe");
    expect(evaluateRule(rule, state.fields).state).toBe("unresolved");
    state = answer(state, "employee_is_senior", "oui");
    expect(evaluateRule(rule, state.fields)).toMatchObject({ state: "included" });
    for (const id of exclusive) expect(inactiveFields(state).has(id)).toBe(false);
    state = answer(state, "employee_is_senior", "no");
    expect(evaluateRule(rule, state.fields)).toMatchObject({ state: "excluded", reason: "Employee is senior = No" });
    expect(inactiveFields(state).has("restricted_area")).toBe(true);
    expect(inactiveFields(state).has("employer_name")).toBe(false);
    expect(evaluateRule({ ...rule, override: "include" }, state.fields)).toMatchObject({ state: "included", reason: expect.stringMatching(/override/) });
  });
});

describe("model-proposed conditional clauses", () => {
  it("accept only verbatim, well-bounded proposals, and never apply until the user confirms them", async () => {
    const blocks = await indexBlocks(await loadDocxPackage(fixture("synthetic-contrat-prestation-fr")));
    const body = blocks.filter((b) => b.partKind === "body");
    const law = body.find((b) => b.text === "Droit applicable")!;
    const lawText = body[body.indexOf(law) + 1]!;
    const table = body.filter((b) => b.table);
    const proposal = (over: Record<string, unknown>) => ({
      label: "Governing law",
      firstBlockId: law.id,
      lastBlockId: lawText.id,
      conditionName: "foreign_client",
      question: "Is the client established abroad?",
      questionFr: "Le client est-il établi à l'étranger ?",
      evidence: "Le présent contrat est régi par le droit",
      ...over,
    });
    const r = buildFields(blocks, detectMarkers(blocks), {
      notFields: [],
      fields: [],
      proposedRules: [
        proposal({}),
        proposal({
          label: "Invented",
          conditionName: "x_one",
          firstBlockId: body.find((b) => b.text === "Objet")!.id,
          lastBlockId: body.find((b) => b.text === "Objet")!.id,
          evidence: "only if the client agrees in writing",
        }),
        proposal({ label: "Cut table", conditionName: "x_two", firstBlockId: table[0]!.id, lastBlockId: table[1]!.id }),
      ],
    });
    expect(r.rules.map((x) => x.label)).toEqual(["Governing law"]);
    expect(r.rejected.join("\n")).toMatch(/Invented.*not verbatim/);
    expect(r.rejected.join("\n")).toMatch(/Cut table.*table/);
    const state: FieldState = {
      version: 2,
      fields: r.fields,
      draftAnchors: {},
      rules: r.rules,
      ruleIssues: [],
      structureIssues: [],
      pendingClauses: [],
      references: [],
      language: { document: "fr", en: 0, fr: 1 },
      conversationLanguage: null,
    };
    expect(evaluateRule(state.rules[0]!, state.fields).state).toBe("proposed");
    expect(omittedBlocks(state).has(lawText.id)).toBe(false); // the clause stays as written
    expect(inactiveFields(state).has("foreign_client")).toBe(true); // its question is not asked yet
    const confirmed = { ...state, rules: [{ ...state.rules[0]!, confirmed: true }] };
    expect(evaluateRule(confirmed.rules[0]!, confirmed.fields).state).toBe("unresolved");
    expect(inactiveFields(confirmed).has("foreign_client")).toBe(false);
  });
});

describe("structural clause changes on a real DOCX", () => {
  it("excludes, restores exactly once, renumbers references and reports dangling ones", async () => {
    const { original, state: s0 } = await stateFor("synthetic-bilingual-employment");
    const yes = answerAll(answer(s0, "employee_is_senior", "yes"));
    const draft = await renderDraft(original, yes);
    let text = await bodyText(draft.bytes);
    expect(text.join("\n")).not.toMatch(/\[\[/); // control markers never reach the draft
    expect(text.filter((t) => t === "Non-competition")).toHaveLength(1);
    expect(text.join("\n")).toContain("subject to clause 4");

    const no = await updateWorkingDraft({
      working: draft.bytes,
      original,
      state: answer(draft.state, "employee_is_senior", "no"),
      changedFieldIds: ["employee_is_senior"],
    });
    expect(no.clauseChanges).toMatchObject([{ action: "exclude" }]);
    text = await bodyText(no.bytes!);
    expect(text).not.toContain("Non-competition");
    expect(text.join("\n")).toContain("subject to clause 3");
    expect(text.join("\n")).toContain("sous réserve de l’article 3");
    expect(no.state.structureIssues.map((i) => i.message).join("\n")).toMatch(/Clause 3 survives termination.*no longer in the draft/);
    // Numbering definitions are untouched; Word renumbers the remaining clauses itself.
    const numbering = async (b: Uint8Array) => (await JSZip.loadAsync(b)).file("word/numbering.xml")!.async("string");
    expect(await numbering(no.bytes!)).toBe(await numbering(draft.bytes));

    const again = await updateWorkingDraft({
      working: no.bytes!,
      original,
      state: answer(no.state, "employee_is_senior", "yes"),
      changedFieldIds: ["employee_is_senior"],
    });
    expect(await bodyText(again.bytes!)).toEqual(await bodyText(draft.bytes));
    // Applying the same decision again changes nothing (idempotent).
    const same = await updateWorkingDraft({ working: again.bytes!, original, state: again.state, changedFieldIds: [] });
    expect(same.bytes).toBeNull();
    expect(same.clauseChanges).toEqual([]);
  });

  it("asks before removing a hand-edited clause, keeps the edited variant, and restores it on re-include", async () => {
    const { original, state: s0 } = await stateFor("synthetic-bilingual-employment");
    const draft = await renderDraft(original, answerAll(answer(s0, "employee_is_senior", "yes")));
    // Simulate an edit inside the conditional clause, as the browser editor would save it.
    const pkg = await loadDocxPackage(draft.bytes);
    const b = (await indexBlocks(pkg)).find((x) => x.text.startsWith("For "))!;
    await applyTextEdits(pkg, [{ blockId: b.id, start: b.text.length, end: b.text.length, expected: "", value: " (EDITED BY HAND)" }]);
    const edited = await serializePackage(pkg);

    const ask = await updateWorkingDraft({
      working: edited,
      original,
      state: answer(draft.state, "employee_is_senior", "no"),
      changedFieldIds: ["employee_is_senior"],
    });
    expect(ask.bytes).toBeNull();
    expect(ask.needsConfirmation).toMatchObject([{ ruleId: "clause_employee_is_senior", action: "exclude" }]);
    const confirmed = await updateWorkingDraft({
      working: edited,
      original,
      state: ask.state,
      changedFieldIds: [],
      confirmEdited: new Set(["clause_employee_is_senior"]),
    });
    expect((await bodyText(confirmed.bytes!)).join("\n")).not.toContain("EDITED BY HAND");
    expect(confirmed.state.rules[0]!.removedXml).toContain("EDITED BY HAND");
    const back = await updateWorkingDraft({
      working: confirmed.bytes!,
      original,
      state: answer(confirmed.state, "employee_is_senior", "yes"),
      changedFieldIds: ["employee_is_senior"],
    });
    const restored = (await bodyText(back.bytes!)).join("\n");
    expect(restored.match(/EDITED BY HAND/g)).toHaveLength(1);
  });

  it("writes answers given after drafting into a clause that was excluded at generation", async () => {
    const { original, state: s0 } = await stateFor("synthetic-bilingual-employment");
    let s = answer(s0, "employee_is_senior", "no");
    s = answerAll(s);
    for (const id of ["non_compete_period", "restricted_area"])
      s = { ...s, fields: s.fields.map((f) => (f.id === id ? { ...f, status: "missing", displayValue: null, normalized: null } : f)) };
    const draft = await renderDraft(original, s);
    expect((await bodyText(draft.bytes)).join("\n")).not.toContain("Non-competition");
    let next = answer(draft.state, "employee_is_senior", "yes");
    const inc = await updateWorkingDraft({ working: draft.bytes, original, state: next, changedFieldIds: ["employee_is_senior"] });
    expect((await bodyText(inc.bytes!)).join("\n")).toContain("[NON-COMPETE PERIOD]");
    next = answer(inc.state, "non_compete_period", "12 months");
    const filled = await updateWorkingDraft({ working: inc.bytes!, original, state: next, changedFieldIds: ["non_compete_period"] });
    expect(filled.appliedFields).toEqual(["non_compete_period"]);
    expect((await bodyText(filled.bytes!)).join("\n")).toContain("For 12 months after leaving");
  });
});

describe("comparison", () => {
  const rb = (id: string, text: string, paraId: string | null, extra: Partial<RenderedBlock> = {}): RenderedBlock => ({
    ...block(id, text),
    paraId,
    runs: [{ text, bold: false, italic: false, underline: false }],
    numberLabel: null,
    headingLevel: null,
    ...extra,
  });

  it("reports word-level changes exactly, keeps accents/amounts, and ignores run splitting", () => {
    expect(diffTokens("Le loyer est de 1 250,50 EUR.", "Le loyer est de 1 250,55 EUR.")).toEqual([
      { op: "eq", text: "Le loyer est de 1 250," },
      { op: "del", text: "50" },
      { op: "ins", text: "55" },
      { op: "eq", text: " EUR." },
    ]);
    expect(diffTokens("résidence", "residence")).toEqual([
      { op: "del", text: "résidence" },
      { op: "ins", text: "residence" },
    ]);
    const o = [rb("a", "Same text here.", "1"), rb("b", "Repeated.", "2"), rb("c", "Repeated.", "3")];
    const split = rb("a", "Same text here.", "1", {
      runs: [
        { text: "Same ", bold: false, italic: false, underline: false },
        { text: "text here.", bold: false, italic: false, underline: false },
      ],
    });
    expect(compareBlocks(o, [split, o[1]!, o[2]!], { fields: [], rules: [] }).items).toEqual([]);
  });

  it("finds additions, deletions, repeated paragraphs, table cells and bold/list-level changes; reverting removes them", () => {
    const o = [
      rb("a", "Intro.", "1"),
      rb("b", "Repeated.", "2"),
      rb("c", "Repeated.", "3"),
      rb("t", "Rent", "4", { kind: "tableCell", table: { table: 0, row: 1, col: 1 } }),
      rb("d", "Strictly private.", "5", { numbering: { numId: "1", ilvl: 2 }, numberLabel: "3.1.1." }),
    ];
    const c = [
      rb("a", "Intro.", "1"),
      rb("b", "Repeated.", "2"),
      rb("n", "Brand new paragraph.", "9"),
      rb("t", "Rent (monthly)", "4", { kind: "tableCell", table: { table: 0, row: 1, col: 1 } }),
      rb("d", "Strictly private.", "5", {
        numbering: { numId: "1", ilvl: 1 },
        numberLabel: "3.2.",
        runs: [
          { text: "Strictly", bold: true, italic: false, underline: false },
          { text: " private.", bold: false, italic: false, underline: false },
        ],
      }),
    ];
    const r = compareBlocks(o, c, { fields: [], rules: [] });
    expect(r.counts).toMatchObject({ added: 1, deleted: 1, modified: 2 });
    expect(r.items.find((i) => i.type === "deleted")?.segments[0]?.text).toBe("Repeated.");
    expect(r.items.find((i) => i.location === "Table 1, row 2, column 2")?.segments).toContainEqual({ op: "ins", text: " (monthly)" });
    const notes = r.items.flatMap((i) => i.notes);
    expect(notes).toContain("List level 3 → 2");
    expect(notes).toContain("Bold added to “Strictly”");
    expect(compareBlocks(o, o, { fields: [], rules: [] }).items).toEqual([]);
  });

  it("labels filled placeholders and excluded clauses on the real fixture, and never adds markup to the document", async () => {
    const { original, state: s0 } = await stateFor("synthetic-bilingual-employment");
    const draft = await renderDraft(original, answerAll(answer(s0, "employee_is_senior", "no")));
    const op = await loadDocxPackage(original);
    await ensureParaIds(op);
    const r = compareBlocks(await indexBlocks(op), await indexBlocks(await loadDocxPackage(draft.bytes)), draft.state);
    expect(r.items.find((i) => i.type === "clause_excluded")).toMatchObject({
      location: "Conditional clause “Non-competition”",
      notes: ["Excluded: Employee is senior = No"],
    });
    expect(r.items.find((i) => i.type === "markers_removed")).toBeTruthy();
    expect(r.items.flatMap((i) => i.notes).some((n) => n.startsWith("Filled: Employer name"))).toBe(true);
    const xml = await (await JSZip.loadAsync(draft.bytes)).file("word/document.xml")!.async("string");
    expect(xml).not.toMatch(/<ins|<del|w:ins |w:del |lx-diff/);
  });
});
