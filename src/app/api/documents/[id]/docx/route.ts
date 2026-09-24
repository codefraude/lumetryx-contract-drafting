import { readDocx, saveEditorDocx } from "@/server/documents/drafting";
import { DOCX_LIMITS } from "@/server/docx/package";
import { documentIdParam, json, jsonError, PRIVATE_HEADERS } from "@/server/http/responses";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Bytes for the editor: the working draft, or ?which=original for the template preview. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await documentIdParam(params);
    const session = await requireSession();
    const which = new URL(req.url).searchParams.get("which") === "original" ? "original" : "working";
    const { bytes, workingRevision } = await readDocx(session.id, id, which);
    return new Response(new Uint8Array(bytes), { headers: { ...PRIVATE_HEADERS, "Content-Type": DOCX, "X-Working-Revision": String(workingRevision) } });
  } catch (err) {
    return jsonError(err);
  }
}

/** Saves the editor's exported DOCX with an optimistic revision check. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const rev = Number(new URL(req.url).searchParams.get("rev"));
    if (!Number.isInteger(rev) || rev < 1) return json({ code: "invalid", message: "Missing revision." }, 400);
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > DOCX_LIMITS.maxCompressedBytes) return json({ code: "too_large", message: "The edited document is too large to save." }, 413);
    return json(await saveEditorDocx(session.id, id, rev, buf));
  } catch (err) {
    return jsonError(err);
  }
}
