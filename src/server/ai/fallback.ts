import "server-only";
import {
  APICallError,
  wrapLanguageModel,
  type LanguageModelMiddleware,
} from "ai";

type Model = ReturnType<typeof wrapLanguageModel>;
type CallOptions = Parameters<Model["doGenerate"]>[0];
type ProviderOptions = NonNullable<CallOptions["providerOptions"]>;

export class BothFailedError extends Error {
  constructor(
    readonly first: unknown,
    readonly second: unknown,
  ) {
    super("The AI model and its fallback both failed.");
    this.name = "BothFailedError";
  }
}

const downUntil = new Map<string, number>();
const COOLDOWN_MS = 60_000;

export function shouldFallBack(err: unknown): boolean {
  if (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  ) {
    return false;
  }

  if (APICallError.isInstance(err)) {
    return ![400, 413, 422].includes(err.statusCode ?? 0);
  }

  return true;
}

export function withFallback(
  primary: Model,
  fallback: Model,
  fallbackOptions: ProviderOptions,
  onFallback: (err: unknown) => void,
): Model {
  const switched = (params: CallOptions): CallOptions => {
    return {
      ...params,
      providerOptions: {
        ...Object.fromEntries(
          Object.entries(params.providerOptions ?? {}).filter(
            ([k]) => k !== "google",
          ),
        ),
        ...fallbackOptions,
      },
    };
  };

  const key = `${primary.provider}:${primary.modelId}`;

  const resting = () => {
    return (downUntil.get(key) ?? 0) > Date.now();
  };

  const failed = (err: unknown) => {
    if (!shouldFallBack(err)) {
      throw err;
    }

    downUntil.set(key, Date.now() + COOLDOWN_MS);
    onFallback(err);
  };

  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      if (resting()) {
        return fallback.doGenerate(switched(params));
      }

      try {
        return await doGenerate();
      } catch (err) {
        failed(err);

        return fallback
          .doGenerate(switched(params))
          .then(undefined, (second: unknown) =>
            Promise.reject(new BothFailedError(err, second)),
          );
      }
    },
    wrapStream: async ({ doStream, params }) => {
      if (resting()) {
        return fallback.doStream(switched(params));
      }

      try {
        return await doStream();
      } catch (err) {
        failed(err);

        return fallback
          .doStream(switched(params))
          .then(undefined, (second: unknown) =>
            Promise.reject(new BothFailedError(err, second)),
          );
      }
    },
  };

  return wrapLanguageModel({
    model: primary,
    middleware,
  });
}
