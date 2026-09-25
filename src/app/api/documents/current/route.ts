import { currentView } from "@/server/documents/views";
import { json, jsonError } from "@/server/http/responses";
import { currentSession } from "@/server/session";

export const runtime = "nodejs";

/**
 * Recovers the cookie-bound session's latest document (no cross-device drafts).
 */
export async function GET() {
  try {
    const session = await currentSession();

    return json({ document: session ? await currentView(session.id) : null });
  } catch (err) {
    return jsonError(err);
  }
}
