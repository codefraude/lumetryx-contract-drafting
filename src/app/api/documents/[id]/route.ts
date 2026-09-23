import { z } from "zod";
import { json, jsonError, NotFound, UUID } from "@/lib/server/http";
import { deleteDraft, getView, renameDraft, setConversationLanguage } from "@/lib/server/service";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function docId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) throw new NotFound();
  return id;
}

/** Resume a saved draft: returns its persisted state and conversation. No AI call and no regeneration. */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const id = await docId(ctx);
    const session = await requireSession();
    return json(await getView(session.id, id));
  } catch (err) {
    return jsonError(err);
  }
}

const Patch = z.union([
  z.object({ title: z.string().trim().min(1).max(120) }),
  z.object({ language: z.enum(["en", "fr"]).nullable(), fieldsVersion: z.number().int() }),
]);

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const id = await docId(ctx);
    const session = await requireSession();
    const body = Patch.safeParse(await req.json());
    if (!body.success) return json({ code: "invalid", message: "Invalid update." }, 400);
    if ("title" in body.data) return json(await renameDraft(session.id, id, body.data.title));
    return json(await setConversationLanguage(session.id, id, body.data));
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    assertSameOrigin(req);
    const id = await docId(ctx);
    const session = await requireSession();
    await deleteDraft(session.id, id);
    return json({ deleted: id });
  } catch (err) {
    return jsonError(err);
  }
}
