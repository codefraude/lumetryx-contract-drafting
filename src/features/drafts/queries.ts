import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { documentKeys, storeDocument } from "@/features/documents/queries";
import { deleteDraft, fetchDrafts, renameDraft } from "./api";
import type { DraftListItem } from "./contracts";

export const draftKeys = { list: ["drafts", "list"] as const };

export const draftListQuery = () => {
  return queryOptions({
    queryKey: draftKeys.list,
    queryFn: ({ signal }) => fetchDrafts(signal),
    staleTime: 0,
  });
};

export const useDraftList = (enabled: boolean) => {
  return useQuery({
    ...draftListQuery(),
    enabled,
  });
};

const updateItem = (
  id: string,
  change: (d: DraftListItem) => DraftListItem,
) => {
  return (all: DraftListItem[] | undefined) =>
    all?.map((d) => (d.id === id ? change(d) : d));
};

type RenameInput = {
  id: string;
  title: string;
};

export function useRenameDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: RenameInput) => renameDraft(id, title),
    onSuccess: (view) => {
      storeDocument(queryClient, view);

      queryClient.setQueryData(
        draftKeys.list,
        updateItem(view.id, (d) => ({
          ...d,
          title: view.title,
          savedAt: view.savedAt,
          expiresAt: view.expiresAt,
        })),
      );
    },
  });
}

export function useDeleteDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteDraft(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData(
        draftKeys.list,
        (all: DraftListItem[] | undefined) => all?.filter((d) => d.id !== id),
      );

      queryClient.removeQueries({ queryKey: documentKeys.detail(id) });
    },
  });
}
