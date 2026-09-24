import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { applyRuleAction, correctField, fetchCurrentDocument, fetchDocument } from "./api";
import type { DocumentView, RuleAction } from "./contracts/document-view";
import type { FieldCorrection } from "./contracts/requests";

export const documentKeys = {
  all: ["documents"] as const,
  current: () => ["documents", "current"] as const,
  detail: (id: string) => ["documents", "detail", id] as const,
};

/**
 * The persisted view of one draft. It changes at defined boundaries only: a write's response, or
 * the end of a stream (which marks it stale). Never on focus or by polling: this tab is the writer,
 * and revision checks on the server catch other tabs. The editor keeps its own working copy.
 */
export const documentQuery = (id: string) =>
  queryOptions({ queryKey: documentKeys.detail(id), queryFn: ({ signal }) => fetchDocument(id, signal), staleTime: Infinity, refetchOnWindowFocus: false });

export const useDocument = (id: string) => useQuery(documentQuery(id));

/** Keeps the server's answer as the cached view of that draft. */
export const storeDocument = (queryClient: QueryClient, view: DocumentView) => queryClient.setQueryData(documentKeys.detail(view.id), view);

/**
 * The id of the browser's latest draft, reopened when the page loads. Its view is stored as that
 * draft's own entry, so one cache entry per draft holds its data.
 */
export const currentDocumentQuery = (queryClient: QueryClient) =>
  queryOptions({
    queryKey: documentKeys.current(),
    queryFn: async ({ signal }) => {
      const view = await fetchCurrentDocument(signal);
      if (view) storeDocument(queryClient, view);
      return view?.id ?? null;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** Changes part of a cached view (from a streamed event); does nothing when that draft is not cached. */
export const patchDocument = (queryClient: QueryClient, id: string, patch: (view: DocumentView) => DocumentView) =>
  queryClient.setQueryData<DocumentView>(documentKeys.detail(id), (view) => view && patch(view));

/** The answers' version a write is based on, read when the write starts (never from an old render). */
export function fieldsVersionOf(queryClient: QueryClient, id: string): number {
  const view = queryClient.getQueryData<DocumentView>(documentKeys.detail(id));
  if (!view) throw new Error("This draft is no longer open.");
  return view.fieldsVersion;
}

/** A correction from the Details or Clauses panel: a value, or whether the field is required. */
export function useCorrectField(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: Omit<FieldCorrection, "fieldsVersion">) =>
      correctField(documentId, { ...change, fieldsVersion: fieldsVersionOf(queryClient, documentId) }),
    onSuccess: (view) => storeDocument(queryClient, view),
  });
}

/**
 * A clause decision. The server may change the saved draft, so pending editor edits are saved first
 * (`beforeAction`), and the editor reloads only when the draft's revision actually changed.
 */
export function useRuleAction(
  documentId: string,
  { beforeAction, onDraftReplaced }: { beforeAction(): Promise<void>; onDraftReplaced(revision: number): void },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ruleId, action }: { ruleId: string; action: RuleAction }) => {
      await beforeAction();
      const before = queryClient.getQueryData<DocumentView>(documentKeys.detail(documentId))?.workingRevision;
      const view = await applyRuleAction(documentId, { fieldsVersion: fieldsVersionOf(queryClient, documentId), ruleId, action });
      return { view, replaced: view.workingRevision !== before };
    },
    onSuccess: ({ view, replaced }) => {
      storeDocument(queryClient, view);
      if (replaced) onDraftReplaced(view.workingRevision);
    },
  });
}
