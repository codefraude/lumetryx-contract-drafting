import "server-only";
import { APICallError, wrapLanguageModel, type LanguageModelMiddleware } from "ai";

type Model = ReturnType<typeof wrapLanguageModel>;
type CallOptions = Parameters<Model["doGenerate"]>[0];
type ProviderOptions = NonNullable<CallOptions["providerOptions"]>;

/** Both the first model and its fallback failed; classifyAiError reports the two together. */
export class BothFailedError extends Error {
  constructor(
    readonly first: unknown,
    readonly second: unknown,
  ) {
    super("The AI model and its fallback both failed.");
    this.name = "BothFailedError";
  }
}

/** When the first model last failed, per model: while it is overloaded, each attempt costs seconds before its error. */
const downUntil = new Map<string, number>();
const COOLDOWN_MS = 60_000;

/** A stop, or a request the provider rejected as malformed, would fail the same way on the fallback. */
export function shouldFallBack(err: unknown): boolean {
  if (err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message))) return false;
  if (APICallError.isInstance(err)) return ![400, 413, 422].includes(err.statusCode ?? 0);
  return true;
}

/**
 * The first model, with one attempt on the fallback when it fails before answering (overloaded, out of
 * quota, bad key, network); after such a failure the fallback answers alone for a minute. A stream that
 * already started is not switched. `fallbackOptions` replace the first model's Google options, since
 * thinking settings differ between Gemini generations.
 */
export function withFallback(primary: Model, fallback: Model, fallbackOptions: ProviderOptions, onFallback: (err: unknown) => void): Model {
  const switched = (params: CallOptions): CallOptions => ({
    ...params,
    providerOptions: { ...Object.fromEntries(Object.entries(params.providerOptions ?? {}).filter(([k]) => k !== "google")), ...fallbackOptions },
  });
  // ponytail: one cooldown per model in this process; share it (e.g. in Redis) if several instances need to agree.
  const key = `${primary.provider}:${primary.modelId}`;
  const resting = () => (downUntil.get(key) ?? 0) > Date.now();
  const failed = (err: unknown) => {
    if (!shouldFallBack(err)) throw err;
    downUntil.set(key, Date.now() + COOLDOWN_MS);
    onFallback(err);
  };
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      if (resting()) return fallback.doGenerate(switched(params));
      try {
        return await doGenerate();
      } catch (err) {
        failed(err);
        return fallback.doGenerate(switched(params)).then(undefined, (second: unknown) => Promise.reject(new BothFailedError(err, second)));
      }
    },
    wrapStream: async ({ doStream, params }) => {
      if (resting()) return fallback.doStream(switched(params));
      try {
        return await doStream();
      } catch (err) {
        failed(err);
        return fallback.doStream(switched(params)).then(undefined, (second: unknown) => Promise.reject(new BothFailedError(err, second)));
      }
    },
  };
  return wrapLanguageModel({ model: primary, middleware });
}
