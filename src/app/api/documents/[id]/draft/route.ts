import { DraftRequest } from "@/features/documents/contracts/requests";
import { generateDraft } from "@/server/documents/drafting";
import { getView } from "@/server/documents/views";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { sseResponse } from "@/server/http/sse";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const body = DraftRequest.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Invalid request." }, 400);
    await getView(session.id, id); // ownership check before any stream opens
    return sseResponse(req, body.data.requestId, (emit, signal) => generateDraft(session.id, id, body.data, emit, signal));
  } catch (err) {
    return jsonError(err);
  }
}
