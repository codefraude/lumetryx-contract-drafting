import { ChatRequest } from "@/features/documents/contracts/requests";
import { assertAiAvailable } from "@/server/ai/model";
import { rateLimit } from "@/server/cache/redis";
import { chatTurn } from "@/server/documents/answers";
import { getView } from "@/server/documents/views";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { sseResponse } from "@/server/http/sse";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const body = ChatRequest.safeParse(await req.json());

    if (!body.success) {
      return json(
        {
          code: "invalid",
          message: "Message must be 1–2000 characters.",
        },
        400,
      );
    }

    await rateLimit("ai", session.id);
    await getView(session.id, id); // ownership check before any stream opens
    assertAiAvailable();

    return sseResponse(req, body.data.requestId, (emit, signal) =>
      chatTurn(session, id, body.data, emit, signal),
    );
  } catch (err) {
    return jsonError(err);
  }
}
