import { createWordLink } from "@/server/documents/word-link";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { assertSameOrigin, requireSession } from "@/server/session";

export const runtime = "nodejs";

/**
 * A short-lived link to the saved draft that Word on
 * this device can open without the browser's cookie.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(req);
    const id = await documentIdParam(params);
    const session = await requireSession();

    return json(await createWordLink(session, id), 201);
  } catch (err) {
    return jsonError(err);
  }
}
