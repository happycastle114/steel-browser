import { QueryClient } from "@tanstack/react-query"

export function createConsoleQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { networkMode: "always", retry: false },
      queries: {
        refetchInterval: 5_000,
        refetchOnWindowFocus: true,
        retry: false,
        staleTime: 15_000,
      },
    },
  })
}
