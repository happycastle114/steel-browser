import { QueryClientProvider, type QueryClient } from "@tanstack/react-query"
import { createContext, useContext, type ReactNode } from "react"

import type { ManagedApi } from "./client.js"

const ManagedApiContext = createContext<ManagedApi | undefined>(undefined)

export function ConsoleProviders({ api, children, queryClient }: Readonly<{ readonly api: ManagedApi; readonly children: ReactNode; readonly queryClient: QueryClient }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <ManagedApiContext.Provider value={api}>{children}</ManagedApiContext.Provider>
    </QueryClientProvider>
  )
}

export function useManagedApi(): ManagedApi {
  const api = useContext(ManagedApiContext)
  if (api === undefined) throw new TypeError("Managed API provider is missing")
  return api
}
