import { describe, expect, it } from "vitest";
import { boldSpans, messageBlocks } from "@/features/chat/format";
import { resolveTheme } from "@/lib/theme";

describe("assistant reply formatting", () => {
  it("groups paragraphs and lists, and leaves other text alone", () => {
    expect(messageBlocks("Thanks.\nTwo things:\n- the start date\n- the salary\n\n1. First\n2) Second\nClause 3.1 stays as it is.")).toEqual([
      { kind: "p", lines: ["Thanks.", "Two things:"] },
      { kind: "ul", items: ["the start date", "the salary"] },
      { kind: "ol", items: ["First", "Second"] },
      { kind: "p", lines: ["Clause 3.1 stays as it is."] },
    ]);
    expect(messageBlocks("1 250,50 EUR is the rent.")).toEqual([{ kind: "p", lines: ["1 250,50 EUR is the rent."] }]);
    expect(boldSpans("Is **Hélène** senior?")).toEqual([
      { bold: false, text: "Is " },
      { bold: true, text: "Hélène" },
      { bold: false, text: " senior?" },
    ]);
  });
});

describe("theme resolution", () => {
  it("follows the system only while System is chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
