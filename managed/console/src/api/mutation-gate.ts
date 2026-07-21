export const MutationGateState = {
  AUTHENTICATION: "AUTHENTICATION",
  MANAGER_DRAINING: "MANAGER_DRAINING",
  OFFLINE: "OFFLINE",
  READY: "READY",
  STALE: "STALE",
  UNAVAILABLE: "UNAVAILABLE",
} as const
export type MutationGateState = (typeof MutationGateState)[keyof typeof MutationGateState]

export type MutationGate = Readonly<{
  readonly allowed: boolean
  readonly state: MutationGateState
}>

export function assertMutationAllowed(gate: MutationGate): void {
  if (!gate.allowed) throw new MutationGateError(gate.state)
}

export class MutationGateError extends Error {
  override readonly name = "MutationGateError"
  readonly state: MutationGateState

  constructor(state: MutationGateState) {
    super("Manager state must be current, authenticated, and serving before mutation.")
    this.state = state
  }
}
