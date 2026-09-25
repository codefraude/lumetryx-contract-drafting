import { useQuery } from "@tanstack/react-query";
import { compareWithTemplate } from "./api";

/**
 * Reads the editor's content when it runs, so an edit made just before opening Compare is included.
 * Nothing is kept once the panel closes, and focus never re-runs it (Refresh does).
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
