import { z } from "zod";
import {
  LanguageRequest,
  RenameRequest,
} from "@/features/documents/contracts/requests";
import { setConversationLanguage } from "@/server/documents/answers";
import { deleteDraft, renameDraft } from "@/server/documents/drafts";
import { getView } from "@/server/documents/views";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Resume a saved draft: returns its persisted state
 * and conversation. No AI call and no regeneration.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const id = await documentIdParam(params);
    const session = await requireSession();

    return json(await getView(session.id, id));
  } catch (err) {
    return jsonError(err);
  }
}

const Patch = z.union([RenameRequest, LanguageRequest]);

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const body = Patch.safeParse(await req.json());

    if (!body.success) {
      return json(
        {
          code: "invalid",
          message: "Invalid update.",
        },
        400,
      );
    }

    if ("title" in body.data) {
      return json(await renameDraft(session.id, id, body.data.title));
    }

    return json(await setConversationLanguage(session.id, id, body.data));
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();

    await deleteDraft(session.id, id);

    return json({ deleted: id });
  } catch (err) {
    return jsonError(err);
  }
}
