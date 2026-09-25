import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { findLiveSession } from "@/server/db/sessions";
import { env } from "@/server/env";
import { NotFound } from "@/server/http/responses";
import { draftFileName, readDocx } from "./drafting";

const TTL_SECONDS = 300;
const TOKEN =
  /^([0-9a-f-]{36})\.([0-9a-f-]{36})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

const sign = (secretHash: string, payload: string) => {
  return createHmac("sha256", secretHash).update(payload).digest("base64url");
};

export async function createWordLink(
  session: {
    id: string;
    secretHash: string;
  },
  documentId: string,
  now = Date.now(),
) {
  const { filename } = await readDocx(session.id, documentId, "working");
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const payload = `${session.id}.${documentId}.${exp}`;
  const token = `${payload}.${sign(session.secretHash, payload)}`;

  return {
    url: `${new URL(env().APP_URL).origin}/api/word/${token}/${encodeURIComponent(draftFileName(filename))}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function readWordLink(token: string, now = Date.now()) {
  const [, sessionId = "", documentId = "", exp = "0", signature = ""] =
    TOKEN.exec(token) ?? [];

  if (!sessionId || Number(exp) * 1000 < now) {
    throw new NotFound();
  }

  const session = await findLiveSession(sessionId);

  if (
    !session ||
    !timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(
        sign(session.secretHash, `${sessionId}.${documentId}.${exp}`),
      ),
    )
  ) {
    throw new NotFound();
  }

  return readDocx(sessionId, documentId, "working");
}
