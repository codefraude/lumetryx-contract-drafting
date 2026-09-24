import { describe, expect, it } from "vitest";
import { StreamEvent } from "@/features/documents/contracts/stream-events";
import { SseDecoder } from "@/lib/sse";
import { encodeEvent } from "@/server/http/sse";
import { parseDate, parseMoney, templateCurrencyHint } from "@/server/fields/normalize";

describe("dates", () => {
  it("parses unambiguous forms as date-only ISO values", () => {
    expect(parseDate("1 October 2026").normalized).toEqual({ kind: "date", iso: "2026-10-01" });
    expect(parseDate("October 1st, 2026").normalized).toEqual({ kind: "date", iso: "2026-10-01" });
    expect(parseDate("2026-02-28").displayValue).toBe("28 February 2026");
    expect(parseDate("25/12/2026").normalized).toEqual({ kind: "date", iso: "2026-12-25" });
  });
  it("asks instead of guessing", () => {
    expect(parseDate("03/04/2026").status).toBe("needs_clarification");
    expect(parseDate("31 February 2026").status).toBe("needs_clarification");
    expect(parseDate("next Tuesday").status).toBe("needs_clarification");
  });
});

describe("money", () => {
  it("keeps exact decimals and requires an established currency", () => {
    expect(parseMoney("MUR 25,000.50").normalized).toEqual({ kind: "money", amount: "25000.50", currency: "MUR" });
    expect(parseMoney("Rs 25,000", null, "en").status).toBe("needs_clarification");
    expect(parseMoney("Rs 25,000", "MUR", "en")).toMatchObject({
      status: "confirmed",
      displayValue: "Rs 25,000",
      normalized: { amount: "25000", currency: "MUR", symbol: "Rs" },
    });
    expect(parseMoney("25000").status).toBe("needs_clarification");
    expect(parseMoney("€1,200 per month", null, "en").normalized).toEqual({ kind: "money", amount: "1200", currency: "EUR" });
    expect(parseMoney("0.1").normalized).toMatchObject({ amount: "0.1" });
  });
  it("reads French amounts exactly and asks when a separator is ambiguous", () => {
    expect(parseMoney("1 250,50 EUR").normalized).toEqual({ kind: "money", amount: "1250.50", currency: "EUR" });
    expect(parseMoney("1\u202f250,50 €", null, "fr").normalized).toMatchObject({ amount: "1250.50", currency: "EUR" });
    expect(parseMoney("1.250.000,00 EUR").normalized).toMatchObject({ amount: "1250000.00" });
    expect(parseMoney("12,5 EUR", null, "fr").normalized).toMatchObject({ amount: "12.5" });
    // One separator + three digits: thousands in English, a decimal in French. Unknown context asks.
    expect(parseMoney("25,000 EUR").status).toBe("needs_clarification");
    expect(parseMoney("25,000 EUR").note).toMatch(/25,000 \(thousands\) or 25\.000 \(decimals\)/);
    expect(parseMoney("25,000 EUR", null, "fr").status).toBe("needs_clarification");
    expect(parseMoney("25,000 EUR", null, "en").normalized).toMatchObject({ amount: "25000" });
    expect(parseMoney("1 250 roupies").note).toMatch(/several currencies/);
  });
  it("infers currency from the template only when unambiguous", () => {
    expect(templateCurrencyHint("payable in MUR to the Landlord")).toBe("MUR");
    expect(templateCurrencyHint("in MUR or USD")).toBeNull();
  });
});

describe("SSE decoding", () => {
  it("reassembles events split across chunks, including a split multi-byte character", () => {
    const events: StreamEvent[] = [
      { type: "assistant_delta", requestId: "r", seq: 0, text: "Clause 1.1 — “Confidential” ✓" },
      { type: "assistant_done", requestId: "r", seq: 1, text: "done" },
    ];
    const bytes = new TextEncoder().encode(events.map(encodeEvent).join(""));
    const d = new SseDecoder(StreamEvent);
    const out: StreamEvent[] = [];
    for (let i = 0; i < bytes.length; i += 7) out.push(...d.push(bytes.subarray(i, i + 7)));
    expect(out).toEqual(events);
  });

  it("drops a malformed or unknown frame and keeps reading the stream", () => {
    const good = encodeEvent({ type: "assistant_done", requestId: "r", seq: 2, text: "ok" });
    const d = new SseDecoder(StreamEvent);
    const out = d.push(new TextEncoder().encode(`data: {not json\n\ndata: {"type":"unknown"}\n\n${good}`), true);
    expect(out).toEqual([{ type: "assistant_done", requestId: "r", seq: 2, text: "ok" }]);
  });
});
