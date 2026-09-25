import "server-only";
import type { ExportCheck } from "@/features/documents/contracts/export-check";
import { outstandingFields } from "@/features/documents/progress";
import { inactiveFields } from "@/server/clauses/evaluation";
import { detectMarkers } from "@/server/docx/detect";
import { loadDocxPackage } from "@/server/docx/package";
import { indexBlocks } from "@/server/docx/render";
import type { FieldState } from "@/server/fields/state";
import { mustGet, mustGetBytes } from "./access";

async function placeholdersLeft(
  working: Uint8Array,
  state: FieldState,
  inactive: ReadonlySet<string>,
): Promise<string[]> {
  const blocks = await indexBlocks(await loadDocxPackage(working));
  const byPara = new Map(
    blocks.flatMap((b) => (b.paraId ? [[b.paraId, b]] : [])),
  );
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const open = state.fields.filter(
    (f) =>
      f.status !== "confirmed" &&
      f.source !== "condition" &&
      !inactive.has(f.id),
  );
  const found = new Set<string>();

  for (const f of open) {
    for (const a of state.draftAnchors[f.id] ?? []) {
      const b =
        (a.paraId ? byPara.get(a.paraId) : undefined) ?? byId.get(a.blockId);

      if (b && a.text.trim() && b.text.slice(a.start, a.end) === a.text) {
        found.add(a.text.trim());
      }
    }
  }

  const known = new Set(
    open.flatMap((f) =>
      f.occurrences.map((o) => o.expected.trim()).filter(Boolean),
    ),
  );

  for (const m of detectMarkers(blocks)) {
    if (known.has(m.text.trim())) {
      found.add(m.text.trim());
    }
  }

  return [...found].slice(0, 20);
}

export async function exportCheck(
  sessionId: string,
  documentId: string,
): Promise<ExportCheck> {
  const doc = await mustGet(sessionId, documentId);
  const bytes = await mustGetBytes(sessionId, documentId);
  const state = doc.fieldState;
  const inactive = inactiveFields(state);
  const open = outstandingFields(state.fields, inactive).filter(
    (f) => f.source !== "condition",
  );

  return {
    outstanding: open.filter((f) => f.status === "missing").map((f) => f.label),
    unclear: open
      .filter((f) => f.status === "needs_clarification")
      .map((f) => f.label),
    leftBlank: state.fields
      .filter((f) => f.resolution === "left_blank" && !inactive.has(f.id))
      .map((f) => f.label),
    placeholders: bytes.workingDocx
      ? await placeholdersLeft(
          new Uint8Array(bytes.workingDocx),
          state,
          inactive,
        )
      : [],
  };
}
