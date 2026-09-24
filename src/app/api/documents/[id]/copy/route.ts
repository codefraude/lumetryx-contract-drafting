import { copyDraft } from "@/server/documents/drafts";
import { DOCX_LIMITS } from "@/server/docx/package";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";

/** Saves a separate copy of a draft; the body may carry the editor's current DOCX (keeps local edits after a conflict). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > DOCX_LIMITS.maxCompressedBytes) return json({ code: "too_large", message: "The edited document is too large to save." }, 413);
    return json(await copyDraft(session.id, id, buf.byteLength ? buf : null), 201);
  } catch (err) {
    return jsonError(err);
  }
}
