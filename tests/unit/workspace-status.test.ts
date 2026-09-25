import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { DocumentView } from "@/features/documents/contracts/document-view";
import {
  clockTime,
  documentProgress,
  exportWarnings,
  statusLine,
} from "@/features/workspace/workspace-status";
import en from "../../messages/en.json";

const t = createTranslator({
  locale: "en",
  messages: en,
  namespace: "status",
});

const field = (id: string, over: Record<string, unknown> = {}) => {
  return {
    id,
    label: id,
    valueType: "text",
    group: "parties",
    occurrences: [
      {
        blockId: "b1",
        start: 0,
        end: id.length + 4,
        expected: `{{${id}}}`,
        mode: "replace",
        marker: "brace",
      },
    ],
    context: "",
    required: true,
    confidence: 1,
    source: "marker",
    status: "missing",
    rawValue: null,
    displayValue: null,
    normalized: null,
    note: null,
    ...over,
  };
};

const rule = (id: string, over: Record<string, unknown> = {}) => {
  return {
    id,
    label: `${id} clause`,
    source: "marker",
    condition: {
      fieldId: "has_pets",
      op: "is_true",
    },
    confirmed: true,
    dismissed: false,
    override: null,
    evidence: null,
    state: "unresolved",
    reason: "Waiting for an answer.",
    applied: null,
    pending: false,
    hasEditedVariant: false,
    ...over,
  };
};

const view = (over: Record<string, unknown> = {}) => {
  return DocumentView.parse({
    id: "d1",
    filename: "lease.docx",
    title: "Lease",
    fields: [],
    fieldsVersion: 1,
    workingRevision: 0,
    draftStatus: "none",
    draftStale: false,
    phase: "interview",
    analysis: "ai",
    savedAt: "2026-09-24T10:30:00.000Z",
    expiresAt: "2026-10-24T10:30:00.000Z",
    language: {
      document: "en",
      conversation: null,
      effective: "en",
    },
    rules: [],
    ruleIssues: [],
    structureIssues: [],
    inactiveFieldIds: [],
    messages: [],
    ...over,
  });
};

const idle = {
  generating: false,
  hasDraft: false,
  save: "viewing" as const,
  savedAt: "2026-09-24T10:30:00.000Z",
  locale: "en",
};

describe("workspace status", () => {
  const doc = view({
    fields: [
      field("landlord_name"),
      field("rent", {
        status: "confirmed",
        rawValue: "900",
        displayValue: "900",
        normalized: {
          kind: "text",
          value: "900",
        },
      }),
      field("note", { required: false }),
      field("pet_deposit"),
      field("has_pets", {
        source: "condition",
        valueType: "boolean",
        occurrences: [],
      }),
    ],
    rules: [rule("pets")],
    inactiveFieldIds: ["pet_deposit"],
  });
  const inactive = new Set(doc.inactiveFieldIds);

  it("counts details and clause decisions separately", () => {
    expect(documentProgress(doc, inactive)).toEqual({
      confirmed: 1,
      total: 2,
      detailsLeft: 1,
      decisions: 1,
      ready: false,
      hasClauses: true,
      attention: 1,
    });

    expect(statusLine(t, documentProgress(doc, inactive), idle)).toEqual({
      text: "1 detail and 1 decision still needed",
      tone: "neutral",
    });
  });

  it("is ready once every needed answer is confirmed", () => {
    const answered = view({
      fields: [
        field("landlord_name", {
          status: "confirmed",
          rawValue: "Ada",
          displayValue: "Ada",
          normalized: {
            kind: "text",
            value: "Ada",
          },
        }),
      ],
    });
    const p = documentProgress(answered, new Set());

    expect(p).toMatchObject({
      ready: true,
      detailsLeft: 0,
      decisions: 0,
      hasClauses: false,
      attention: 0,
    });

    expect(statusLine(t, p, idle)).toEqual({
      text: "Ready to generate",
      tone: "ok",
    });
  });

  it("reports generation first, then the editor's save state once a draft exists", () => {
    const p = documentProgress(doc, inactive);

    expect(
      statusLine(t, p, {
        ...idle,
        generating: true,
      }).text,
    ).toBe("Generating the draft…");

    expect(
      statusLine(t, p, {
        ...idle,
        hasDraft: true,
        save: "saved",
      }),
    ).toEqual({
      text: `Saved at ${clockTime(idle.savedAt, "en")}`,
      tone: "ok",
    });

    expect(
      statusLine(t, p, {
        ...idle,
        hasDraft: true,
        save: "conflict",
      }),
    ).toMatchObject({
      text: "Changed in another tab",
      tone: "warn",
    });
  });

  it("lists what to review before an export", () => {
    const risky = view({
      rules: [
        rule("pets"),
        rule("parking", {
          state: "included",
          pending: true,
        }),
      ],
      structureIssues: [
        {
          ruleId: null,
          message: "A clause marker is not closed.",
        },
      ],
      ruleIssues: ["An unknown condition was ignored."],
    });

    expect(exportWarnings(t, risky)).toEqual([
      "“pets clause” is still undecided.",
      "“parking clause” waits for your confirmation.",
      "A clause marker is not closed.",
      "An unknown condition was ignored.",
    ]);
  });
});
