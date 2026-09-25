import "server-only";
import type { CompareResponse } from "@/features/comparison/contracts";
import { compareBlocks } from "@/server/diff/compare-blocks";
import { loadDocxPackage } from "@/server/docx/package";
import { ensureParaIds } from "@/server/docx/para-ids";
import { indexBlocks } from "@/server/docx/render";
import { renderDraft } from "@/server/draft/generate";
import { mustGet, mustGetBytes } from "./access";

export async function compare(
  sessionId: string,
  documentId: string,
  snapshot: Uint8Array | null,
): Promise<CompareResponse> {
  const doc = await mustGet(sessionId, documentId);
  const bytes = await mustGetBytes(sessionId, documentId);
  const originalPkg = await loadDocxPackage(new Uint8Array(bytes.originalDocx));

  await ensureParaIds(originalPkg);
  const original = await indexBlocks(originalPkg);
  let source: CompareResponse["source"];
  let current: Uint8Array;
  let state = doc.fieldState;

  if (snapshot && doc.draftStatus === "ready") {
    source = "editor";
    current = snapshot;
  } else if (bytes.workingDocx && doc.draftStatus === "ready") {
    source = "working";
    current = new Uint8Array(bytes.workingDocx);
  } else {
    source = "preview";
    const r = await renderDraft(new Uint8Array(bytes.originalDocx), state);

    current = r.bytes;
    state = r.state;
  }

  const currentBlocks = await indexBlocks(await loadDocxPackage(current));

  return {
    source,
    result: compareBlocks(original, currentBlocks, {
      fields: state.fields,
      rules: state.rules,
    }),
  };
}
