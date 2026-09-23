import { DOCX_LIMITS } from "@/lib/docx/package";
import { json, jsonError, NotFound, UUID } from "@/lib/server/http";
import { copyDraft } from "@/lib/server/service";
import { assertSameOrigin, requireSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** Saves a separate copy of a draft; the body may carry the editor's current DOCX (keeps local edits after a conflict). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { id } = await params;
    if (!UUID.test(id)) throw new NotFound();
    const session = await requireSession();
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > DOCX_LIMITS.maxCompressedBytes) return json({ code: "too_large", message: "The edited document is too large to save." }, 413);
    return json(await copyDraft(session.id, id, buf.byteLength ? buf : null), 201);
  } catch (err) {
    return jsonError(err);
  }
}
