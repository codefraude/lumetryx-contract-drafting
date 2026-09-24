/**
 * TEST DOUBLES — the mocked language model and in-memory KV store below are used only by
 * automated tests. They never run in the application and prove nothing about live Gemini.
 */
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { KeyValueStore } from "@/server/cache/redis";

const usage = (i: number, o: number) => ({
  inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: o, text: o, reasoning: undefined },
});

export interface MockScript {
  /** Returns the JSON object for a structured (generateText) call, given the prompt text. */
  object: (prompt: string) => unknown;
  /** Reply text, streamed in several chunks. */
  reply?: (prompt: string) => string;
  failGenerate?: boolean;
  /** The reply call fails the way an overloaded Gemini does (503), after the answers were extracted. */
  failStream?: boolean;
}

const promptText = (opts: { prompt: unknown }) => JSON.stringify(opts.prompt);

export function mockModel(script: MockScript) {
  const model = new MockLanguageModelV4({
    modelId: "mock-gemini",
    doGenerate: async (opts) => {
      if (script.failGenerate) throw new Error("mock provider failure");
      return {
        content: [{ type: "text", text: JSON.stringify(script.object(promptText(opts))) }],
        finishReason: { unified: "stop", raw: "STOP" },
        usage: usage(100, 20),
        warnings: [],
      };
    },
    doStream: async (opts) => {
      if (script.failStream) throw new APICallError({ message: "This model is currently experiencing high demand.", url: "https://mock.invalid", requestBodyValues: {}, statusCode: 503, isRetryable: false });
      const text = script.reply?.(promptText(opts)) ?? "Thanks. Who is the landlord, and are they an individual or a company?";
      const chunks = text.match(/.{1,12}/gs) ?? [text];
      return {
        stream: new ReadableStream({
          async start(c) {
            c.enqueue({ type: "stream-start", warnings: [] });
            c.enqueue({ type: "text-start", id: "t" });
            for (const delta of chunks) {
              c.enqueue({ type: "text-delta", id: "t", delta });
              await new Promise((r) => setTimeout(r, 2));
            }
            c.enqueue({ type: "text-end", id: "t" });
            c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "STOP" }, usage: usage(80, 30) });
            c.close();
          },
        }),
      };
    },
  });
  return model;
}

export class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  reads = 0;
  async get(key: string) {
    this.reads++;
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string, opts: { ttlSeconds: number; onlyIfAbsent?: boolean }) {
    if (opts.onlyIfAbsent && this.data.has(key)) return false;
    this.data.set(key, value);
    return true;
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async delIfEquals(key: string, value: string) {
    if (this.data.get(key) === value) this.data.delete(key);
  }
}

export class BrokenStore implements KeyValueStore {
  async get(): Promise<string | null> {
    throw new Error("redis down");
  }
  async set(): Promise<boolean> {
    throw new Error("redis down");
  }
  async del() {
    throw new Error("redis down");
  }
  async delIfEquals() {
    throw new Error("redis down");
  }
}
