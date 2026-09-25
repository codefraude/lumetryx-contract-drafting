import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/server/env";

const strict = () => {
  return env().NODE_ENV === "production" && !env().ALLOW_NO_REDIS;
};

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts: {
      ttlSeconds: number;
      onlyIfAbsent?: boolean;
    },
  ): Promise<boolean>;
  del(key: string): Promise<void>;
  delIfEquals(key: string, value: string): Promise<void>;
}

class UpstashStore implements KeyValueStore {
  constructor(private redis: Redis) {}

  async get(key: string) {
    const v = await this.redis.get<string>(key);

    return v === null || v === undefined
      ? null
      : typeof v === "string"
        ? v
        : JSON.stringify(v);
  }

  async set(
    key: string,
    value: string,
    opts: {
      ttlSeconds: number;
      onlyIfAbsent?: boolean;
    },
  ) {
    const res = opts.onlyIfAbsent
      ? await this.redis.set(key, value, {
          ex: opts.ttlSeconds,
          nx: true,
        })
      : await this.redis.set(key, value, { ex: opts.ttlSeconds });

    return res === "OK";
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async delIfEquals(key: string, value: string) {
    await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      [key],
      [value],
    );
  }
}

let store: KeyValueStore | null | undefined;
let override: KeyValueStore | null | undefined;
let redisClient: Redis | null = null;

export function setStoreForTests(s: KeyValueStore | null | undefined) {
  override = s;
}

export function getStore(): KeyValueStore | null {
  if (override !== undefined) {
    return override;
  }

  if (store !== undefined) {
    return store;
  }

  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } =
    env();

  redisClient =
    url && token
      ? new Redis({
          url,
          token,
        })
      : null;

  store = redisClient ? new UpstashStore(redisClient) : null;

  return store;
}

const MAX_CACHE_BYTES = 256 * 1024;

export async function cacheGet<T>(
  key: string,
  parse: (raw: unknown) => T,
): Promise<T | null> {
  const s = getStore();

  if (!s) {
    return null;
  }

  try {
    const raw = await s.get(key);

    return raw ? parse(JSON.parse(raw)) : null;
  } catch (err) {
    console.warn(
      `[cache] read failed for ${key.split(":").slice(0, 2).join(":")}:…`,
      err instanceof Error ? err.message : err,
    );

    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  const s = getStore();

  if (!s) {
    return;
  }

  const payload = JSON.stringify(value);

  if (payload.length > MAX_CACHE_BYTES) {
    return;
  }

  try {
    await s.set(key, payload, { ttlSeconds });
  } catch (err) {
    console.warn(
      "[cache] write failed",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Best-effort invalidation; a failure only means the entry lives until its TTL.
 */
export async function cacheDel(keys: string[]): Promise<void> {
  const s = getStore();

  if (!s) {
    return;
  }

  for (const key of keys) {
    await s
      .del(key)
      .catch((err: Error) =>
        console.warn("[cache] delete failed", err.message),
      );
  }
}

/**
 * Rate limits or request deduplication are required
 * (production) but Redis is missing or failing.
 */
export class ProtectionUnavailableError extends Error {
  override name = "ProtectionUnavailableError";
}

export class BusyError extends Error {
  constructor() {
    super("This request is already running. Wait for it to finish.");
    this.name = "BusyError";
  }
}

export async function withLock<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const s = getStore();
  const token = crypto.randomUUID();

  if (!s) {
    if (strict()) {
      throw new ProtectionUnavailableError(
        "Request deduplication is unavailable (Redis not configured).",
      );
    }

    return fn();
  }

  let acquired: boolean;

  try {
    acquired = await s.set(key, token, {
      ttlSeconds,
      onlyIfAbsent: true,
    });
  } catch (err) {
    if (strict()) {
      throw new ProtectionUnavailableError(
        "Request deduplication is temporarily unavailable.",
        { cause: err },
      );
    }

    return fn();
  }

  if (!acquired) {
    throw new BusyError();
  }

  try {
    return await fn();
  } finally {
    await s.delIfEquals(key, token).catch(() => undefined);
  }
}

export type LimitKind = "session_create" | "ai" | "upload";

const limiters = new Map<LimitKind, Ratelimit>();
const LIMITS: Record<LimitKind, [number, `${number} ${"s" | "m" | "h"}`]> = {
  session_create: [10, "1 h"],
  upload: [20, "1 h"],
  ai: [30, "5 m"],
};

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `Too many requests. Try again in about ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute(s).`,
    );

    this.name = "RateLimitedError";
  }
}

export async function rateLimit(
  kind: LimitKind,
  identifier: string,
): Promise<void> {
  if (override !== undefined) {
    return;
  } // a test store skips rate limits

  getStore();

  if (!redisClient) {
    if (strict()) {
      throw new ProtectionUnavailableError(
        "Abuse protection is unavailable (Redis not configured); refusing costly requests.",
      );
    }

    return;
  }

  let limiter = limiters.get(kind);

  if (!limiter) {
    const [n, window] = LIMITS[kind];

    limiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(n, window),
      prefix: `lx:rl:${kind}`,
    });

    limiters.set(kind, limiter);
  }

  try {
    const res = await limiter.limit(identifier);

    if (!res.success) {
      throw new RateLimitedError((res.reset - Date.now()) / 1000);
    }
  } catch (err) {
    if (err instanceof RateLimitedError) {
      throw err;
    }

    if (strict()) {
      throw new ProtectionUnavailableError(
        "Abuse protection is temporarily unavailable.",
        { cause: err },
      );
    }
  }
}
