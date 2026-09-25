import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { findLiveSession } from "@/server/db/sessions";
import { env } from "@/server/env";
import { NotFound } from "@/server/http/responses";
import { draftFileName, readDocx } from "./drafting";

/** How long Word has to fetch the draft after the click. */
const TTL_SECONDS = 300;
const TOKEN = /^([0-9a-f-]{36})\.([0-9a-f-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

const sign = (secretHash: string, payload: string) => createHmac("sha256", secretHash).update(payload).digest("base64url");

/**
 * A link Word can open without this browser's cookie: the saved draft only, for five minutes. It is
 * signed with the session's own secret hash, so it stops working when the session ends.
 */
export async function createWordLink(session: { id: string; secretHash: string }, documentId: string, now = Date.now()) {
  // Checks ownership, and that a draft exists, before anything is signed.
  const { filename } = await readDocx(session.id, documentId, "working");
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = `${session.id}.${documentId}.${exp}`;
  const token = `${payload}.${sign(session.secretHash, payload)}`;
  return {
    url: `${new URL(env().APP_URL).origin}/api/word/${token}/${encodeURIComponent(draftFileName(filename))}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** The saved draft a Word link points at. A malformed, forged, expired or revoked link is simply not found. */
export async function readWordLink(token: string, now = Date.now()) {
  const [, sessionId = "", documentId = "", exp = "0", signature = ""] = TOKEN.exec(token) ?? [];
  if (!sessionId || Number(exp) * 1000 < now) throw new NotFound();
  const session = await findLiveSession(sessionId);
  if (!session || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(session.secretHash, `${sessionId}.${documentId}.${exp}`)))) throw new NotFound();
  return readDocx(sessionId, documentId, "working");
}
