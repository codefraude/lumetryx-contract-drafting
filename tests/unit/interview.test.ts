import { describe, expect, it } from "vitest";
import { APICallError, RetryError } from "ai";
import { applyExtraction } from "@/server/ai/extraction";
import { clauseContext, replyPrompt } from "@/server/ai/reply";
import { renderAt } from "@/server/fields/normalize";
import { errorBody } from "@/server/http/responses";
import {
  fieldDefaults,
  type Field,
} from "@/features/documents/contracts/fields";

const field = (
  id: string,
  label: string,
  group: Field["group"],
  status: Field["status"] = "missing",
): Field => {
  return {
    ...fieldDefaults(),
    id,
    label,
    valueType: "text",
    group,
    occurrences: [
      {
        blockId: "word/document.xml#0",
        start: 0,
        end: 0,
        expected: "",
        mode: "insert",
        marker: "implicit",
        lang: "fr",
      },
    ],
    context: "",
    required: true,
    confidence: 0.9,
    source: "marker",
    status,
    rawValue: status === "confirmed" ? "x" : null,
    displayValue: status === "confirmed" ? "x" : null,
    normalized: null,
    note: null,
    related: [],
  };
};

describe("reply prompt", () => {
  it("names every detail still needed, so none is skipped or taken for done", () => {
    const fields = [
      field("sender_name", "Votre nom", "parties", "confirmed"),
      field(
        "insurer_address",
        "Adresse postale (compagnie d’assurance)",
        "other",
        "confirmed",
      ),
      field("sender_address", "Adresse postale (expéditeur)", "other"),
      field("increase", "Pourcentage d’augmentation", "money"),
    ];
    const p = replyPrompt(
      fields,
      ["insurer_address"],
      "",
      "ave nue porlouis",
      [],
      "fr",
    );

    expect(p).toContain(
      "JUST RECORDED: Adresse postale (compagnie d’assurance) = x",
    );

    expect(p).toContain("NEXT TO ASK: Pourcentage d’augmentation");

    expect(p).toContain(
      "STILL NEEDED LATER (do not ask yet): Adresse postale (expéditeur)",
    );

    expect(p).toContain("READY TO GENERATE: no");
  });

  it("asks at most three items at once and lists the rest", () => {
    const fields = ["a", "b", "c", "d"].map((id) =>
      field(id, id.toUpperCase(), "parties"),
    );
    const p = replyPrompt(fields, [], "", "bonjour", [], "fr");

    expect(p).toContain("NEXT TO ASK: A; B; C\n");
    expect(p).toContain("STILL NEEDED LATER (do not ask yet): D");
  });

  it("is ready only when nothing required is outstanding", () => {
    const p = replyPrompt(
      [field("a", "A", "parties", "confirmed")],
      [],
      "",
      "merci",
      [],
      "fr",
    );

    expect(p).toContain("NEXT TO ASK: none");
    expect(p).toContain("READY TO GENERATE: yes");
  });
});

describe("messy answers found by the live evaluation", () => {
  const date = (): Field => {
    return {
      ...field("start_date", "Start date", "dates"),
      valueType: "date",
    };
  };

  const extract = (value: string, evidence: string) => {
    return {
      updates: [
        {
          fieldId: "start_date",
          value,
          currency: null,
          evidence,
        },
      ],
      clauseBlockIds: [],
    };
  };

  it("checks a date written in figures as the user wrote it, whatever the model made of it", () => {
    const ambiguous = applyExtraction(
      [date()],
      extract("3 April 2026", "03/04/2026"),
      "the lease starts 03/04/2026",
      null,
    );

    expect(ambiguous.fields[0]).toMatchObject({
      status: "needs_clarification",
      rawValue: "03/04/2026",
    });

    const clear = applyExtraction(
      [date()],
      extract("25 December 2026", "25/12/2026"),
      "it starts 25/12/2026",
      null,
    );

    expect(clear.fields[0]).toMatchObject({
      status: "confirmed",
      normalized: {
        kind: "date",
        iso: "2026-12-25",
      },
    });

    const two = applyExtraction(
      [date()],
      extract("1 October 2026", "from 01/10/2026 to 30/09/2027"),
      "from 01/10/2026 to 30/09/2027",
      null,
    );

    expect(two.fields[0]).toMatchObject({
      status: "confirmed",
      normalized: {
        kind: "date",
        iso: "2026-10-01",
      },
    });
  });

  it("gives the reply the clause text without internal block ids", () => {
    const clause = {
      id: "word/document.xml#8",
      part: "word/document.xml",
      partKind: "body" as const,
      ordinal: 8,
      kind: "listItem" as const,
      styleId: null,
      numbering: {
        numId: "1",
        ilvl: 2,
      },
      table: null,
      text: "Late payments attract interest.",
      paraId: null,
    };

    expect(clauseContext([clause], [clause.id])).toBe(
      "Late payments attract interest.",
    );
  });

  it("reports an overloaded model as unavailable, not as an internal error", () => {
    const overload = new APICallError({
      message: "This model is currently experiencing high demand.",
      url: "https://mock.invalid",
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: true,
    });
    const afterRetries = new RetryError({
      message: "Failed after 3 attempts.",
      reason: "maxRetriesExceeded",
      errors: [overload],
    });

    expect(errorBody(afterRetries)).toMatchObject({
      status: 502,
      code: "unavailable",
      retryable: true,
      message:
        "Gemini is overloaded or down right now and did not reply. Wait a few seconds, then retry.",
    });
  });
});

describe("answers the NDA test run got wrong", () => {
  const dateField = (): Field => {
    return {
      ...field("effective_date", "Effective date", "dates", "confirmed"),
      valueType: "date",
      rawValue: "25 September 2026",
      displayValue: "25 September 2026",
      normalized: {
        kind: "date",
        iso: "2026-09-25",
      },
    };
  };

  const update = (
    fieldId: string,
    value: string,
    evidence: string,
    keepFormat?: boolean,
  ) => {
    return {
      updates: [
        {
          fieldId,
          value,
          currency: null,
          evidence,
          ...(keepFormat === undefined ? {} : { keepFormat }),
        },
      ],
      clauseBlockIds: [],
    };
  };

  it("writes a date in the user's figures when they ask for that format", () => {
    const msg = "change the format of the date put 26/09/2026";
    const r = applyExtraction(
      [dateField()],
      update("effective_date", "26/09/2026", "26/09/2026", true),
      msg,
      null,
    );
    const [f] = r.fields;

    expect(r.changed).toEqual(["effective_date"]);
    expect(f?.displayValue).toBe("26/09/2026");

    expect(f?.normalized).toEqual({
      kind: "date",
      iso: "2026-09-26",
      figures: "26/09/2026",
    });

    expect(renderAt(f!, "fr", "mixed")).toBe("26/09/2026");
    expect(renderAt(f!, "en", "mixed")).toBe("26/09/2026");
  });

  it("applies a format change even when the date itself is unchanged", () => {
    const before = {
      ...dateField(),
      rawValue: "26/09/2026",
      displayValue: "26 September 2026",
      normalized: {
        kind: "date" as const,
        iso: "2026-09-26",
      },
    };
    const r = applyExtraction(
      [before],
      update("effective_date", "26/09/2026", "26/09/2026", true),
      "write it as 26/09/2026",
      null,
    );

    expect(r.changed).toEqual(["effective_date"]);
    expect(r.fields[0]?.displayValue).toBe("26/09/2026");
  });

  it("keeps the long form when no format was asked for, even if the model says so", () => {
    for (const keepFormat of [undefined, true]) {
      const r = applyExtraction(
        [dateField()],
        update("effective_date", "26/09/2026", "26/09/2026", keepFormat),
        "the effective date is 26/09/2026",
        null,
      );

      expect(r.fields[0]?.displayValue).toBe("26 September 2026");
    }

    const fr = applyExtraction(
      [dateField()],
      update("effective_date", "26/09/2026", "26/09/2026", true),
      "écris la date en chiffres : 26/09/2026",
      null,
    );

    expect(fr.fields[0]?.displayValue).toBe("26/09/2026");
  });

  it("capitalises names and addresses typed all in lower case, and nothing else", () => {
    const party = {
      ...field("party_a_name", "Party A name", "parties"),
      valueType: "party" as const,
    };
    const address = {
      ...field("party_a_address", "Party A address", "parties"),
      valueType: "address" as const,
    };
    const email = field("party_a_email", "Party A email", "parties");
    const msg =
      "party a is jane van der berg, 12 rue des lilas, port louis, jane.berg@example.com";
    const r = applyExtraction(
      [party, address, email],
      {
        updates: [
          {
            fieldId: "party_a_name",
            value: "jane van der berg",
            currency: null,
            evidence: "jane van der berg",
          },
          {
            fieldId: "party_a_address",
            value: "12 rue des lilas, port louis",
            currency: null,
            evidence: "12 rue des lilas, port louis",
          },
          {
            fieldId: "party_a_email",
            value: "jane.berg@example.com",
            currency: null,
            evidence: "jane.berg@example.com",
          },
        ],
        clauseBlockIds: [],
      },
      msg,
      null,
    );

    expect(r.fields.map((f) => f.displayValue)).toEqual([
      "Jane van der Berg",
      "12 Rue des Lilas, Port Louis",
      "jane.berg@example.com",
    ]);

    const typed = applyExtraction(
      [party],
      update("party_a_name", "ACME Ltd", "ACME Ltd"),
      "it is ACME Ltd",
      null,
    );

    expect(typed.fields[0]?.displayValue).toBe("ACME Ltd");
  });

  it("tells the reply that a draft exists, and never to generate it again", () => {
    const fields = [
      {
        ...dateField(),
        displayValue: "26/09/2026",
      },
    ];
    const p = replyPrompt(
      fields,
      ["effective_date"],
      "",
      "put 26/09/2026",
      [],
      "en",
      new Set(),
      {
        applied: ["effective_date"],
        conflicts: [],
      },
    );

    expect(p).toContain("DRAFT: already generated");
    expect(p).toContain("written into the draft: Effective date");
    expect(p).not.toContain("READY TO GENERATE: yes");

    const before = replyPrompt(fields, [], "", "hi", [], "en");

    expect(before).toContain("DRAFT: not generated yet");
    expect(before).toContain("READY TO GENERATE: yes");
  });
});

describe("a template with its own currency field", () => {
  it("reads later amounts in the currency already answered there", () => {
    const currency = {
      ...field("currency", "Currency / Devise", "money", "confirmed"),
      rawValue: "MUR",
      displayValue: "MUR",
    };
    const advance = {
      ...field("advance_payment", "Advance payment / Acompte", "money"),
      valueType: "money" as const,
    };
    const r = applyExtraction(
      [currency, advance],
      {
        updates: [
          {
            fieldId: "advance_payment",
            value: "150,00",
            currency: null,
            evidence: "150,00",
          },
        ],
        clauseBlockIds: [],
      },
      "l'acompte est de 150,00",
      null,
      "fr",
    );
    const paid = r.fields.find((f) => f.id === "advance_payment");

    expect(paid?.status).toBe("confirmed");

    expect(paid?.normalized).toMatchObject({
      kind: "money",
      currency: "MUR",
    });
  });
});
