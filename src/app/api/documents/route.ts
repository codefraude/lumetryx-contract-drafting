import { assertSameOrigin, getOrCreateSession } from "@/server/session";
import { rateLimit } from "@/server/cache/redis";
import { DOCX_LIMITS } from "@/server/docx/package";
import { createFromUpload } from "@/server/documents/upload";
import { json, jsonError } from "@/server/http/responses";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const len = Number(req.headers.get("content-length") ?? 0);

    if (len > DOCX_LIMITS.maxCompressedBytes + 64 * 1024) {
      return json(
        {
          code: "too_large",
          message: "Files up to 5 MB are supported.",
        },
        413,
      );
    }

    const session = await getOrCreateSession(req);

    await rateLimit("upload", session.id);
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json(
        {
          code: "no_file",
          message: "Choose a .docx file to upload.",
        },
        400,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = await createFromUpload(
      session,
      file.name || "template.docx",
      bytes,
    );

    return json(view, 201);
  } catch (err) {
    return jsonError(err);
  }
}
