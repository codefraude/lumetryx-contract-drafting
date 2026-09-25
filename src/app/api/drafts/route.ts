import { listDrafts } from "@/server/documents/drafts";
import { json, jsonError } from "@/server/http/responses";
import { currentSession } from "@/server/session";

export const runtime = "nodejs";

/** Saved drafts of this browser (anonymous cookie identity); an unknown browser has none. */
export async function GET() {
  try {
    const session = await currentSession();
    return json({ drafts: session ? await listDrafts(session.id) : [] });
  } catch (err) {
    return jsonError(err);
  }
}
