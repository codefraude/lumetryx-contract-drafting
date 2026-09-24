import { FieldCorrection } from "@/features/documents/contracts/requests";
import { correctField } from "@/server/documents/answers";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const body = FieldCorrection.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Invalid field update." }, 400);
    return json(await correctField(session.id, id, body.data));
  } catch (err) {
    return jsonError(err);
  }
}
