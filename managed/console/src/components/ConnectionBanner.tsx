import { useMutationGate } from "../api/mutation-gate-context.js"
import { MutationGateState } from "../api/mutation-gate.js"
import { NoticeTone, assertNever } from "../domain/vocabulary.js"
import { InlineNotice } from "./InlineNotice.js"

export function ConnectionBanner() {
  const gate = useMutationGate()
  switch (gate.state) {
    case MutationGateState.READY:
      return null
    case MutationGateState.OFFLINE:
      return <InlineNotice message="Cached data may be out of date. Mutating controls stay unavailable until the manager is reachable." title="This device is offline" tone={NoticeTone.WARNING} />
    case MutationGateState.STALE:
      return <InlineNotice message="The last manager response is older than the allowed freshness window. Refresh before changing browser state." title="Manager state is stale" tone={NoticeTone.WARNING} />
    case MutationGateState.AUTHENTICATION:
      return <InlineNotice message="Open this host through its Cloudflare Access login and verify this identity is authorized, then reload." title="Authentication required" tone={NoticeTone.ERROR} />
    case MutationGateState.MANAGER_DRAINING:
      return <InlineNotice message="The manager is draining for handover. Existing state remains visible, but mutations are paused." title="Manager is draining" tone={NoticeTone.WARNING} />
    case MutationGateState.UNAVAILABLE:
      return <InlineNotice message="Current manager state could not be confirmed. Mutating controls stay unavailable." title="Manager state is unavailable" tone={NoticeTone.ERROR} />
    default:
      return assertNever(gate.state)
  }
}
