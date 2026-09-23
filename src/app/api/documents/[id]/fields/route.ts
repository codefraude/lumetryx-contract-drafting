import { z } from "zod";
import { json, jsonError, NotFound, UUID } from "@/lib/server/http";
import { correctField } from "@/lib/server/service";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({ fieldsVersion: z.number().int(), fieldId: z.string().max(64), value: z.string().max(500).nullable().optional(), required: z.boolean().optional(), label: z.string().min(1).max(120).optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await params;
    if (!UUID.test(id)) throw new NotFound();
    const session = await requireSession();
    const body = Body.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Invalid field update." }, 400);
    return json(await correctField(session.id, id, body.data));
  } catch (err) {
    return jsonError(err);
  }
}
