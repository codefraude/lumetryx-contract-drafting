/**
 * Retention cleanup. Removes drafts whose retention has passed (their messages cascade), then
 * anonymous sessions that have expired and own no remaining draft, and drops cached template
 * analyses of the removed drafts. Bounded: at most BATCH × MAX_BATCHES drafts per run.
 * Expired drafts are already never served; this only reclaims space.
 *
 *   npm run db:cleanup            (reads .env.local when present)
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  /* environment provided by the caller */
}

const { deleteExpired } = await import("../src/lib/db/repo");
const { cacheDel } = await import("../src/lib/cache/redis");
const { PARSER_VERSION, analysisCacheKey } = await import("../src/lib/ai/analyze");
const { modelId } = await import("../src/lib/ai/model");

const BATCH = 500;
const MAX_BATCHES = 20;
let drafts = 0;
let sessions = 0;
for (let i = 0; i < MAX_BATCHES; i++) {
  const r = await deleteExpired(BATCH);
  drafts += r.documents.length;
  sessions += r.sessions;
  await cacheDel(r.documents.flatMap((d) => [`lx:blocks:${d.sessionId}:${d.templateHash}:${PARSER_VERSION}`, analysisCacheKey(d.sessionId, d.templateHash, modelId())]));
  if (r.documents.length < BATCH) break;
}
console.log(`Removed ${drafts} expired draft(s) and ${sessions} expired session(s).`);
process.exit(0);

export {};
