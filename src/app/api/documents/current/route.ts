import { json, jsonError } from "@/lib/server/http";
import { currentView } from "@/lib/server/service";
import { currentSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** Recovers the cookie-bound session's latest document (no cross-device drafts). */
export async function GET() {
  try {
    const session = await currentSession();
    return json({ document: session ? await currentView(session.id) : null });
  } catch (err) {
    return jsonError(err);
  }
}
