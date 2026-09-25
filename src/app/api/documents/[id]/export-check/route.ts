import { exportCheck } from "@/server/documents/export-check";
import { documentIdParam, json, jsonError } from "@/server/http/responses";
import { requireSession } from "@/server/session";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = await documentIdParam(params);
    const session = await requireSession();

    return json(await exportCheck(session.id, id));
  } catch (err) {
    return jsonError(err);
  }
}
