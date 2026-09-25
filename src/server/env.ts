import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  GEMINI_THINKING_LEVEL: z
    .enum(["minimal", "low", "medium", "high"])
    .default("minimal"),
  AI_PROVIDER: z.enum(["auto", "gemini", "gateway"]).default("auto"),
  AI_GATEWAY_API_KEY: z.string().min(10).optional(),
  AI_GATEWAY_MODEL: z.string().default("google/gemini-2.5-flash-lite"),
  DATABASE_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  AI_MAX_REQUESTS_PER_SESSION: z.coerce.number().int().positive().default(80),
  AI_MAX_TOKENS_PER_SESSION: z.coerce
    .number()
    .int()
    .positive()
    .default(400_000),
  ALLOW_NO_REDIS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  DRAFT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) {
    return cached;
  }

  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
  );

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

    throw new Error(
      `Invalid server configuration — ${issues}. See .env.example.`,
    );
  }

  cached = parsed.data;

  return cached;
}

export class ConfigMissingError extends Error {
  constructor(
    readonly variable: string,
    purpose: string,
  ) {
    super(
      `${variable} is not configured, so ${purpose} is unavailable. Add it to .env (see .env.example).`,
    );

    this.name = "ConfigMissingError";
  }
}

export function requireEnv<
  K extends "GEMINI_API_KEY" | "AI_GATEWAY_API_KEY" | "DATABASE_URL",
>(key: K, purpose: string): string {
  const v = env()[key];

  if (!v) {
    throw new ConfigMissingError(key, purpose);
  }

  return v;
}
