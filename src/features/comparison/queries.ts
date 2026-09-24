import { useQuery } from "@tanstack/react-query";
import { compareWithTemplate } from "./api";

/**
 * The comparison for one version of a draft. `revisionKey` changes whenever the server changes the
 * draft or its answers. The editor's current content is read when the comparison runs, so an edit
 * made just before opening Compare is included; nothing is kept once the panel closes, and focus
 * never re-runs it (that is what Refresh is for).
 */
export const useComparison = (documentId: string, revisionKey: string, snapshot: () => Promise<Blob | null>) =>
  useQuery({
    queryKey: ["comparison", documentId, revisionKey] as const,
    queryFn: async ({ signal }) => compareWithTemplate(documentId, await snapshot(), signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
