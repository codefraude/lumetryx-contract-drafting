import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  /** "minimal" is the lowest documented Gemini 3 thinking level. */
  GEMINI_THINKING_LEVEL: z.enum(["minimal", "low", "medium", "high"]).default("minimal"),
  DATABASE_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Per-session ceilings. These bound usage; they are not a billing guarantee. */
  AI_MAX_REQUESTS_PER_SESSION: z.coerce.number().int().positive().default(80),
  AI_MAX_TOKENS_PER_SESSION: z.coerce.number().int().positive().default(400_000),
  /** Local-only escape hatch: run a production build without Redis (no rate limits, no dedupe). Never set on a public deployment. */
  ALLOW_NO_REDIS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Saved drafts are kept this many days after their last save; the browser credential lasts as long (sliding). */
  DRAFT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // `.env.example` ships keys as `KEY=`; an empty value means "not configured", not an invalid value.
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration — ${issues}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}

export class ConfigMissingError extends Error {
  constructor(
    readonly variable: string,
    purpose: string,
  ) {
    super(`${variable} is not configured, so ${purpose} is unavailable. Add it to .env.local (see .env.example).`);
    this.name = "ConfigMissingError";
  }
}

export function requireEnv<K extends "GEMINI_API_KEY" | "DATABASE_URL">(key: K, purpose: string): string {
  const v = env()[key];
  if (!v) throw new ConfigMissingError(key, purpose);
  return v;
}
