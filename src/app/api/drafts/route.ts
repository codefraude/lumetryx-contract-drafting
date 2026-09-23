import { json, jsonError } from "@/lib/server/http";
import { listDrafts } from "@/lib/server/service";
import { currentSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** Saved drafts of this browser (anonymous cookie identity). An unknown browser simply has none. */
export async function GET() {
  try {
    const session = await currentSession();
    return json({ drafts: session ? await listDrafts(session.id) : [] });
  } catch (err) {
    return jsonError(err);
  }
}
