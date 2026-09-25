import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { rateLimit } from "@/server/cache/redis";
import { createSession, findSession } from "@/server/db/sessions";
import { env } from "@/server/env";

const COOKIE = "lx_session";

export const hashSecret = (secret: string) => {
  return createHash("sha256").update(secret).digest("hex");
};

export class UnauthorizedError extends Error {
  constructor() {
    super(
      "This browser has no saved drafts session (it may have expired, or cookies were cleared). Upload the template again to start a new one.",
    );

    this.name = "UnauthorizedError";
  }
}

export class ForbiddenOriginError extends Error {
  constructor() {
    super("Request origin not allowed.");
    this.name = "ForbiddenOriginError";
  }
}

export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");

  if (!origin) {
    if (req.headers.get("sec-fetch-site") === "cross-site") {
      throw new ForbiddenOriginError();
    }

    return;
  }

  const allowed = new Set([new URL(env().APP_URL).origin]);
  const host = req.headers.get("host");

  if (host) {
    allowed.add(`${new URL(req.url).protocol}//${host}`);
  }

  if (!allowed.has(origin)) {
    throw new ForbiddenOriginError();
  }
}

const cookieOptions = () => {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: new URL(env().APP_URL).protocol === "https:",
    path: "/",
    maxAge: env().DRAFT_RETENTION_DAYS * 86_400,
  };
};

function parseCookie(value: string | undefined): {
  id: string;
  secret: string;
} | null {
  if (!value) {
    return null;
  }

  const [id, secret] = value.split(".");

  if (
    !id ||
    !secret ||
    !/^[0-9a-f-]{36}$/.test(id) ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret)
  ) {
    return null;
  }

  return {
    id,
    secret,
  };
}

export async function currentSession() {
  const jar = await cookies();
  const parsed = parseCookie(jar.get(COOKIE)?.value);

  if (!parsed) {
    return null;
  }

  const hash = hashSecret(parsed.secret);
  const row = await findSession(parsed.id, hash);

  if (!row) {
    return null;
  }

  if (!timingSafeEqual(Buffer.from(row.secretHash), Buffer.from(hash))) {
    return null;
  }

  if (row.refreshed) {
    try {
      jar.set(COOKIE, `${parsed.id}.${parsed.secret}`, cookieOptions());
    } catch {}
  }

  return row;
}

export async function requireSession() {
  const s = await currentSession();

  if (!s) {
    throw new UnauthorizedError();
  }

  return s;
}

export async function getOrCreateSession(req: Request) {
  const existing = await currentSession();

  if (existing) {
    return existing;
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

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

  if (!row) {
    throw new UnauthorizedError();
  }

  return row;
}
