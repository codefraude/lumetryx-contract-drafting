import { z } from "zod";
import { rateLimit } from "@/lib/cache/redis";
import { json, jsonError, NotFound, sseResponse, UUID } from "@/lib/server/http";
import { chatTurn, getView, assertAiAvailable } from "@/lib/server/service";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ message: z.string().trim().min(1).max(2000), fieldsVersion: z.number().int(), requestId: z.string().uuid() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await params;
    if (!UUID.test(id)) throw new NotFound();
    const session = await requireSession();
    const body = Body.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Message must be 1–2000 characters." }, 400);
    await rateLimit("ai", session.id);
    await getView(session.id, id); // ownership check before any stream opens
    assertAiAvailable();
    return sseResponse(req, body.data.requestId, (emit, signal) => chatTurn(session, id, body.data, emit, signal));
  } catch (err) {
    return jsonError(err);
  }
}
