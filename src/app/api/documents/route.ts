import { rateLimit } from "@/lib/cache/redis";
import { DOCX_LIMITS } from "@/lib/docx/package";
import { json, jsonError } from "@/lib/server/http";
import { createFromUpload } from "@/lib/server/service";
import { assertSameOrigin, getOrCreateSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > DOCX_LIMITS.maxCompressedBytes + 64 * 1024) return json({ code: "too_large", message: "Files up to 5 MB are supported." }, 413);
    const session = await getOrCreateSession(req);
    await rateLimit("upload", session.id);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ code: "no_file", message: "Choose a .docx file to upload." }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = await createFromUpload(session, file.name || "template.docx", bytes);
    return json(view, 201);
  } catch (err) {
    return jsonError(err);
  }
}
