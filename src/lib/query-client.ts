import { QueryClient } from "@tanstack/react-query";
import { isTransient } from "./http";

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => failures < 2 && isTransient(error),
      },
      mutations: { retry: false },
    },
  });
}

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }

  browserClient ??= makeQueryClient();

  return browserClient;
}
