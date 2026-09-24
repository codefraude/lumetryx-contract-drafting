import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { documentKeys, storeDocument } from "@/features/documents/queries";
import { deleteDraft, fetchDrafts, renameDraft } from "./api";
import type { DraftListItem } from "./contracts";

export const draftKeys = { list: ["drafts", "list"] as const };

/** The saved-drafts list is re-read whenever the drawer opens (it changes with every save), showing the last copy meanwhile. */
export const draftListQuery = () => queryOptions({ queryKey: draftKeys.list, queryFn: ({ signal }) => fetchDrafts(signal), staleTime: 0 });

export const useDraftList = (enabled: boolean) => useQuery({ ...draftListQuery(), enabled });

const updateItem = (id: string, change: (d: DraftListItem) => DraftListItem) => (all: DraftListItem[] | undefined) =>
  all?.map((d) => (d.id === id ? change(d) : d));

/** Renames a draft; the list row and, if it is cached, the draft's own view take the server's answer. */
export function useRenameDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameDraft(id, title),
    onSuccess: (view) => {
      storeDocument(queryClient, view);
      queryClient.setQueryData(
        draftKeys.list,
        updateItem(view.id, (d) => ({ ...d, title: view.title, savedAt: view.savedAt, expiresAt: view.expiresAt })),
      );
    },
  });
}

/** Deletes a draft for good; its cached view is dropped with it. */
export function useDeleteDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDraft(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData(draftKeys.list, (all: DraftListItem[] | undefined) => all?.filter((d) => d.id !== id));
      queryClient.removeQueries({ queryKey: documentKeys.detail(id) });
    },
  });
}
