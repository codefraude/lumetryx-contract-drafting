import { readDocx } from "@/server/documents/drafting";
import { documentIdParam, jsonError, PRIVATE_HEADERS } from "@/server/http/responses";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";

const safeName = (name: string) =>
  name
    .replace(/\.docx$/i, "")
    .replace(/[^\w .-]+/g, "_")
    .slice(0, 80) || "contract";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await documentIdParam(params);
    const session = await requireSession();
    const { bytes, filename, workingRevision } = await readDocx(session.id, id, "working");
    const name = `${safeName(filename)} - draft.docx`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "X-Working-Revision": String(workingRevision),
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
