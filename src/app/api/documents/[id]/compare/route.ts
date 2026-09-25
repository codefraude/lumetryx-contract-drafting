import { compare } from "@/server/documents/comparison";
import { DOCX_LIMITS } from "@/server/docx/package";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();
    const buf = new Uint8Array(await req.arrayBuffer());

    if (buf.byteLength > DOCX_LIMITS.maxCompressedBytes) {
      return json(
        {
          code: "too_large",
          message: "The document is too large to compare.",
        },
        413,
      );
    }

    return json(await compare(session.id, id, buf.byteLength ? buf : null));
  } catch (err) {
    return jsonError(err);
  }
}
