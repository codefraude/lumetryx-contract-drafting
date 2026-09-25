import { RuleActionRequest } from "@/features/documents/contracts/requests";
import { ruleAction } from "@/server/documents/answers";
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
    const body = RuleActionRequest.safeParse(await req.json());

    if (!body.success) {
      return json(
        {
          code: "invalid",
          message: "Invalid clause action.",
        },
        400,
      );
    }

    return json(await ruleAction(session.id, id, body.data));
  } catch (err) {
    return jsonError(err);
  }
}
