import { describe, expect, it } from "vitest";
import { APICallError, RetryError } from "ai";
import { applyExtraction } from "@/server/ai/extraction";
import { clauseContext, replyPrompt } from "@/server/ai/reply";
import { errorBody } from "@/server/http/responses";
import type { Field } from "@/features/documents/contracts/fields";

const field = (
  id: string,
  label: string,
  group: Field["group"],
  status: Field["status"] = "missing",
): Field => {
  return {
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
