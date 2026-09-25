try {
  process.loadEnvFile(".env.local");
} catch {}

const { deleteExpired } = await import("../src/server/db/repo");
const { cacheDel } = await import("../src/server/cache/redis");
const { analysisCacheKey } = await import("../src/server/ai/analyze");
const { blocksCacheKey } = await import("../src/server/documents/access");
const { modelId } = await import("../src/server/ai/model");

const BATCH = 500;
const MAX_BATCHES = 20;
let drafts = 0;
let sessions = 0;

for (let i = 0; i < MAX_BATCHES; i++) {
  const r = await deleteExpired(BATCH);

  drafts += r.documents.length;
  sessions += r.sessions;

  await cacheDel(
    r.documents.flatMap((d) => [
      blocksCacheKey(d.sessionId, d.templateHash),
      analysisCacheKey(d.sessionId, d.templateHash, modelId()),
    ]),
  );

  if (r.documents.length < BATCH) {
    break;
  }
}

console.log(
  `Removed ${drafts} expired draft(s) and ${sessions} expired session(s).`,
);

process.exit(0);

export {};
