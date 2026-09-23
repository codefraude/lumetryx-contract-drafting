import { z } from "zod";
import { json, jsonError, NotFound, sseResponse, UUID } from "@/lib/server/http";
import { generateDraft, getView } from "@/lib/server/service";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ fieldsVersion: z.number().int(), requestId: z.string().uuid() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await params;
    if (!UUID.test(id)) throw new NotFound();
    const session = await requireSession();
    const body = Body.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Invalid request." }, 400);
    await getView(session.id, id); // ownership check before any stream opens
    return sseResponse(req, body.data.requestId, (emit, signal) => generateDraft(session.id, id, body.data, emit, signal));
  } catch (err) {
    return jsonError(err);
  }
}
