import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { rateLimit } from "@/server/cache/redis";
import { createSession, findSession } from "@/server/db/repo";
import { env } from "@/server/env";

const COOKIE = "lx_session";

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

export class UnauthorizedError extends Error {
  constructor() {
    super("This browser has no saved drafts session (it may have expired, or cookies were cleared). Upload the template again to start a new one.");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenOriginError extends Error {
  constructor() {
    super("Request origin not allowed.");
    this.name = "ForbiddenOriginError";
  }
}

/** Rejects cross-site state-changing requests (defence in depth beyond SameSite=Lax). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients omit Origin; browsers always send it on cross-origin POST/PUT/PATCH.
    if (req.headers.get("sec-fetch-site") === "cross-site") throw new ForbiddenOriginError();
    return;
  }
  const allowed = new Set([new URL(env().APP_URL).origin]);
  const host = req.headers.get("host");
  if (host) allowed.add(`${new URL(req.url).protocol}//${host}`);
  if (!allowed.has(origin)) throw new ForbiddenOriginError();
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env().NODE_ENV === "production",
  path: "/",
  // Same lifetime as the database expiry, which slides with activity (see repo.findSession).
  maxAge: env().DRAFT_RETENTION_DAYS * 86_400,
});

function parseCookie(value: string | undefined): { id: string; secret: string } | null {
  if (!value) return null;
  const [id, secret] = value.split(".");
  if (!id || !secret || !/^[0-9a-f-]{36}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id, secret };
}

/** Returns the current session, or null. Never creates one. */
export async function currentSession() {
  const jar = await cookies();
  const parsed = parseCookie(jar.get(COOKIE)?.value);
  if (!parsed) return null;
  const hash = hashSecret(parsed.secret);
  const row = await findSession(parsed.id, hash);
  if (!row) return null;
  // Constant-time comparison of the stored hash (lookup already matched; belt and braces).
  if (!timingSafeEqual(Buffer.from(row.secretHash), Buffer.from(hash))) return null;
  if (row.refreshed) {
    try {
      jar.set(COOKIE, `${parsed.id}.${parsed.secret}`, cookieOptions());
    } catch {
      /* read-only context (not a route handler): the next API call refreshes it */
    }
  }
  return row;
}

export async function requireSession() {
  const s = await currentSession();
  if (!s) throw new UnauthorizedError();
  return s;
}

/** Creates a session on first upload; rate limited per client address. */
export async function getOrCreateSession(req: Request) {
  const existing = await currentSession();
  if (existing) return existing;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  await rateLimit("session_create", ip);
  const secret = randomBytes(32).toString("base64url");
  const id = await createSession(hashSecret(secret));
  const jar = await cookies();
  jar.set(COOKIE, `${id}.${secret}`, cookieOptions());
  const row = await currentSessionById(id, secret);
  return row;
}

async function currentSessionById(id: string, secret: string) {
  const row = await findSession(id, hashSecret(secret));
  if (!row) throw new UnauthorizedError();
  return row;
}
