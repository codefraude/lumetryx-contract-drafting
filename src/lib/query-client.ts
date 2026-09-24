import { QueryClient } from "@tanstack/react-query";
import { isTransient } from "./http";

/**
 * TanStack Query holds the browser's copy of server data (the open draft's view, the saved-drafts
 * list, comparisons); Neon stays the source of truth. Queries retry only transient failures, twice;
 * mutations never retry by themselves, so a write happens again only when the person asks.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (failures, error) => failures < 2 && isTransient(error) },
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | undefined;

/** One client per browser tab; a server render (which never fetches here) gets its own. */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  browserClient ??= makeQueryClient();
  return browserClient;
}
