import { z } from "zod";
import { json, jsonError, NotFound, UUID } from "@/lib/server/http";
import { ruleAction } from "@/lib/server/service";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

const Body = z.object({ fieldsVersion: z.number().int(), ruleId: z.string().max(64), action: z.enum(["confirm", "dismiss", "include", "exclude", "clear_override", "apply"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await params;
    if (!UUID.test(id)) throw new NotFound();
    const session = await requireSession();
    const body = Body.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Invalid clause action." }, 400);
    return json(await ruleAction(session.id, id, body.data));
  } catch (err) {
    return jsonError(err);
  }
}
