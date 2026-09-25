import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ApiError } from "@/lib/http";

/**
 * Any 401 means this browser's anonymous session is gone (expired, or its cookie cleared).
 * The caller then drops the cached private data.
 */
export function useSessionLoss(onLost: (message: string) => void) {
  const queryClient = useQueryClient();
  const handler = useRef(onLost);
  useEffect(() => {
    handler.current = onLost;
  });
  useEffect(() => {
    const check = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) handler.current(error.message);
    };
    const offQueries = queryClient.getQueryCache().subscribe((e) => e.type === "updated" && e.action.type === "error" && check(e.action.error));
    const offMutations = queryClient.getMutationCache().subscribe((e) => e.type === "updated" && e.action.type === "error" && check(e.action.error));
    return () => {
      offQueries();
      offMutations();
    };
  }, [queryClient]);
}
