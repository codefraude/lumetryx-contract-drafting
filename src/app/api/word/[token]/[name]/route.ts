import { draftFileName } from "@/server/documents/drafting";
import { readWordLink } from "@/server/documents/word-link";
import { jsonError, PRIVATE_HEADERS } from "@/server/http/responses";

export const runtime = "nodejs";

type Context = {
  params: Promise<{
    token: string;
    name: string;
  }>;
};

/**
 * The saved draft for Word, which fetches it without the
 * browser's cookie; the link itself is the credential.
 */
async function serve({ params }: Context, withBody: boolean) {
  try {
    const { bytes, filename } = await readWordLink((await params).token);
    const name = draftFileName(filename);

    return new Response(withBody ? new Uint8Array(bytes) : null, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

export const GET = (_req: Request, ctx: Context) => {
  return serve(ctx, true);
};

// Word asks for the headers before it downloads the file.
export const HEAD = (_req: Request, ctx: Context) => {
  return serve(ctx, false);
};
