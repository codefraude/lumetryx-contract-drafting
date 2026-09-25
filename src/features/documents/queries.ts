import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { ApiError } from "@/lib/http";
import {
  applyRuleAction,
  correctField,
  fetchCurrentDocument,
  fetchDocument,
} from "./api";
import type { DocumentView, RuleAction } from "./contracts/document-view";
import type { FieldCorrection } from "./contracts/requests";

export const documentKeys = {
  all: ["documents"] as const,
  current: () => {
    return ["documents", "current"] as const;
  },
  detail: (id: string) => {
    return ["documents", "detail", id] as const;
  },
};

export const documentQuery = (id: string) => {
  return queryOptions({
    queryKey: documentKeys.detail(id),
    queryFn: ({ signal }) => fetchDocument(id, signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

export const useDocument = (id: string) => {
  return useQuery(documentQuery(id));
};

export const storeDocument = (queryClient: QueryClient, view: DocumentView) => {
  return queryClient.setQueryData(documentKeys.detail(view.id), view);
};

export const currentDocumentQuery = (queryClient: QueryClient) => {
  return queryOptions({
    queryKey: documentKeys.current(),
    queryFn: async ({ signal }) => {
      const view = await fetchCurrentDocument(signal);

      if (view) {
        storeDocument(queryClient, view);
      }

      return view?.id ?? null;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

export const patchDocument = (
  queryClient: QueryClient,
  id: string,
  patch: (view: DocumentView) => DocumentView,
) => {
  return queryClient.setQueryData<DocumentView>(
    documentKeys.detail(id),
    (view) => view && patch(view),
  );
};

export function fieldsVersionOf(queryClient: QueryClient, id: string): number {
  const view = queryClient.getQueryData<DocumentView>(documentKeys.detail(id));

  if (!view) {
    throw new ApiError(
      "draft_closed",
      "This draft is no longer open.",
      0,
      true,
    );
  }

  return view.fieldsVersion;
}

export function useCorrectField(documentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (change: Omit<FieldCorrection, "fieldsVersion">) =>
      correctField(documentId, {
        ...change,
        fieldsVersion: fieldsVersionOf(queryClient, documentId),
      }),
    onSuccess: (view) => storeDocument(queryClient, view),
  });
}

export function useRuleAction(
  documentId: string,
  {
    beforeAction,
    onDraftReplaced,
  }: {
    beforeAction(): Promise<void>;
    onDraftReplaced(revision: number): void;
  },
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ruleId,
      action,
    }: {
      ruleId: string;
      action: RuleAction;
    }) => {
      await beforeAction();
      const before = queryClient.getQueryData<DocumentView>(
        documentKeys.detail(documentId),
      )?.workingRevision;
      const view = await applyRuleAction(documentId, {
        fieldsVersion: fieldsVersionOf(queryClient, documentId),
        ruleId,
        action,
      });

      return {
        view,
        replaced: view.workingRevision !== before,
      };
    },
    onSuccess: ({ view, replaced }) => {
      storeDocument(queryClient, view);

      if (replaced) {
        onDraftReplaced(view.workingRevision);
      }
    },
  });
}
