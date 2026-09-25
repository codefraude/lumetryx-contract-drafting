import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { retention } from "@/server/db/repo";
import { sessions } from "@/server/db/schema";

export async function createSession(secretHash: string): Promise<string> {
  const [row] = await getDb().insert(sessions).values({ secretHash, expiresAt: retention() }).returning({ id: sessions.id });
  if (!row) throw new Error("The session was not created.");
  return row.id;
}

/**
 * Looks up an unexpired session. Activity refreshes the expiry at most hourly (to avoid a write per
 * request); `refreshed` tells the caller to re-issue the cookie with the same lifetime.
 */
export async function findSession(id: string, secretHash: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.secretHash, secretHash), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() < 3_600_000) return { ...row, refreshed: false };
  const [upd] = await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt: retention() }).where(eq(sessions.id, id)).returning();
  return { ...(upd ?? row), refreshed: true };
}

/** An unexpired session by id alone, for links signed with its secret hash; it does not count as activity. */
export async function findLiveSession(id: string) {
  const [row] = await getDb()
    .select({ id: sessions.id, secretHash: sessions.secretHash })
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  return row ?? null;
}

export async function recordUsage(sessionId: string, input: number, output: number) {
  await getDb()
    .update(sessions)
    .set({
      aiRequests: sql`${sessions.aiRequests} + 1`,
      aiInputTokens: sql`${sessions.aiInputTokens} + ${input}`,
      aiOutputTokens: sql`${sessions.aiOutputTokens} + ${output}`,
    })
    .where(eq(sessions.id, sessionId));
}
