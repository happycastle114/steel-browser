import { createContext, useContext, type ReactNode } from "react"

import type { MutationGate } from "./mutation-gate.js"

const MutationGateContext = createContext<MutationGate | undefined>(undefined)

export function MutationGateProvider({ children, value }: Readonly<{ readonly children: ReactNode; readonly value: MutationGate }>) {
  return <MutationGateContext.Provider value={value}>{children}</MutationGateContext.Provider>
}

export function useMutationGate(): MutationGate {
  const gate = useContext(MutationGateContext)
  if (gate === undefined) throw new TypeError("Mutation gate provider is missing")
  return gate
}
