import { describe, expect, it, vi } from "vitest";
import {
  GatewayAuthenticationError,
  GatewayInternalServerError,
  GatewayRateLimitError,
} from "@ai-sdk/gateway";
import { APICallError, generateText, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { BothFailedError, withFallback } from "@/server/ai/fallback";
import { classifyAiError } from "@/server/ai/model";

const usage = {
  inputTokens: {
    total: 5,
    noCache: 5,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: 2,
    text: 2,
    reasoning: undefined,
  },
};

const apiError = (statusCode: number) => {
  return new APICallError({
    message: "This model is currently experiencing high demand.",
    url: "https://mock.invalid",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });
};

const answering = (text: string) => {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text,
        },
      ],
      finishReason: {
        unified: "stop",
        raw: "STOP",
      },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(c) {
          c.enqueue({
            type: "stream-start",
            warnings: [],
          });

          c.enqueue({
            type: "text-start",
            id: "t",
          });

          c.enqueue({
            type: "text-delta",
            id: "t",
            delta: text,
          });

          c.enqueue({
            type: "text-end",
            id: "t",
          });

          c.enqueue({
            type: "finish",
            finishReason: {
              unified: "stop",
              raw: "STOP",
            },
            usage,
          });

          c.close();
        },
      }),
    }),
  });
};

// Each failing model gets its own id, because
// a failure rests that model for a minute.
let nextId = 0;

const failing = (error: () => unknown) => {
  return new MockLanguageModelV4({
    modelId: `failing-${nextId++}`,
    doGenerate: async () => {
      throw error();
    },
    doStream: async () => {
      throw error();
    },
  });
};

describe("Gemini with the Vercel AI Gateway as fallback", () => {
  it("answers from the gateway when Gemini is overloaded, with the gateway model's own thinking options", async () => {
    const gateway = answering("from the gateway");
    const onFallback = vi.fn();
    const model = withFallback(
      failing(() => apiError(503)),
      gateway,
      {},
      onFallback,
    );
    const r = await generateText({
      model,
      prompt: "hi",
      maxRetries: 0,
      providerOptions: {
        google: { thinkingConfig: { thinkingLevel: "minimal" } },
        other: { a: 1 },
      },
    });

    expect(r.text).toBe("from the gateway");
    expect(onFallback).toHaveBeenCalledOnce();

    // Gemini 2.5 on the gateway rejects a thinking
    // level, so the Gemini 3 option is not forwarded.
    expect(gateway.doGenerateCalls[0]?.providerOptions).toEqual({
      other: { a: 1 },
    });
  });

  it("skips Gemini for a minute after it failed, instead of waiting for its error on every call", async () => {
    const gemini = failing(() => apiError(503));
    const gateway = answering("from the gateway");
    const onFallback = vi.fn();

    for (let i = 0; i < 3; i++) {
      await generateText({
        model: withFallback(gemini, gateway, {}, onFallback),
        prompt: "hi",
        maxRetries: 0,
      });
    }

    expect(gemini.doGenerateCalls).toHaveLength(1);
    expect(gateway.doGenerateCalls).toHaveLength(3);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it("streams the reply from the gateway when Gemini's quota is used up", async () => {
    const r = streamText({
      model: withFallback(
        failing(() => apiError(429)),
        answering("streamed"),
        {},
        () => undefined,
      ),
      prompt: "hi",
      maxRetries: 0,
    });

    expect(await r.text).toBe("streamed");
  });

  it("does not switch when the user stopped or the request was malformed", async () => {
    for (const error of [
      () =>
        Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        }),
      () => apiError(400),
    ]) {
      const gateway = answering("unused");

      await expect(
        generateText({
          model: withFallback(failing(error), gateway, {}, () => undefined),
          prompt: "hi",
          maxRetries: 0,
        }),
      ).rejects.toThrow();

      expect(gateway.doGenerateCalls).toHaveLength(0);
    }
  });

  it("reports both failures together, with the gateway's reason and next step", async () => {
    const freeTier = () => {
      return new GatewayInternalServerError({
        message: "Free tier users do not have access to this model.",
        statusCode: 403,
      });
    };

    const err = await generateText({
      model: withFallback(
        failing(() => apiError(503)),
        failing(freeTier),
        {},
        () => undefined,
      ),
      prompt: "hi",
      maxRetries: 0,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(BothFailedError);
    const reported = classifyAiError(err);

    expect(reported).toMatchObject({
      code: "model_unavailable",
      retryable: false,
    });

    expect(reported.message).toMatch(
      /^Gemini failed, and so did the fallback through the Vercel AI Gateway\. .*AI_GATEWAY_MODEL/,
    );
  });

  it("names the gateway and what to check in its own errors", () => {
    expect(
      classifyAiError(
        new GatewayAuthenticationError({
          message: "Invalid API key",
          statusCode: 401,
        }),
      ),
    ).toMatchObject({
      code: "invalid_key",
      retryable: false,
      message:
        "The Vercel AI Gateway rejected the API key. Check AI_GATEWAY_API_KEY.",
    });

    expect(
      classifyAiError(
        new GatewayRateLimitError({
          message: "Rate limited",
          statusCode: 429,
        }),
      ),
    ).toMatchObject({
      code: "quota",
      retryable: true,
    });

    expect(
      classifyAiError(
        new GatewayInternalServerError({
          message: "Upstream error",
          statusCode: 502,
        }),
      ),
    ).toMatchObject({
      code: "unavailable",
      retryable: true,
    });
  });
});
