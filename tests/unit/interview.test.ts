import { describe, expect, it } from "vitest";
import { replyPrompt } from "@/server/ai/reply";
import type { Field } from "@/features/documents/contracts/fields";

const field = (id: string, label: string, group: Field["group"], status: Field["status"] = "missing"): Field => ({
  id,
  label,
  valueType: "text",
  group,
  occurrences: [{ blockId: "word/document.xml#0", start: 0, end: 0, expected: "", mode: "insert", marker: "implicit", lang: "fr" }],
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
});

describe("reply prompt", () => {
  it("names every detail still needed, so none is skipped or taken for done", () => {
    const fields = [
      field("sender_name", "Votre nom", "parties", "confirmed"),
      field("insurer_address", "Adresse postale (compagnie d’assurance)", "other", "confirmed"),
      field("sender_address", "Adresse postale (expéditeur)", "other"),
      field("increase", "Pourcentage d’augmentation", "money"),
    ];
    const p = replyPrompt(fields, ["insurer_address"], "", "ave nue porlouis", [], "fr");
    expect(p).toContain("JUST RECORDED: Adresse postale (compagnie d’assurance) = x");
    expect(p).toContain("NEXT TO ASK: Pourcentage d’augmentation");
    expect(p).toContain("STILL NEEDED LATER (do not ask yet): Adresse postale (expéditeur)");
    expect(p).toContain("READY TO GENERATE: no");
  });

  it("asks at most three items at once and lists the rest", () => {
    const fields = ["a", "b", "c", "d"].map((id) => field(id, id.toUpperCase(), "parties"));
    const p = replyPrompt(fields, [], "", "bonjour", [], "fr");
    expect(p).toContain("NEXT TO ASK: A; B; C\n");
    expect(p).toContain("STILL NEEDED LATER (do not ask yet): D");
  });

  it("is ready only when nothing required is outstanding", () => {
    const p = replyPrompt([field("a", "A", "parties", "confirmed")], [], "", "merci", [], "fr");
    expect(p).toContain("NEXT TO ASK: none");
    expect(p).toContain("READY TO GENERATE: yes");
  });
});
