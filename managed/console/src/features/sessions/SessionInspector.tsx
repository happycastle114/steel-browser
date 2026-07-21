import { Eye, LockKeyhole, RotateCcw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { useCapabilitiesQuery, useReleaseSessionMutation, useSessionQuery } from "../../api/queries.js"
import { ManagedApiError, MutationCertainty } from "../../api/client.js"
import { useMutationGate } from "../../api/mutation-gate-context.js"
import { ApiPath } from "../../api/client.js"
import type { SessionId } from "../../api/schema-primitives.js"
import { ActionButton, ButtonVariant } from "../../components/ActionButton.js"
import { EmptyState } from "../../components/EmptyState.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { StateLabel } from "../../components/StateLabel.js"
import { ConsoleState, NoticeTone, SessionState, assertNever } from "../../domain/vocabulary.js"
import { durationSince, formatTimestamp } from "../../lib/format.js"
import { ActionPanel } from "./ActionPanel.js"
import { SessionEvents } from "./SessionEvents.js"

export function SessionInspector({ sessionId }: Readonly<{ readonly sessionId: SessionId | undefined }>) {
  const session = useSessionQuery(sessionId)
  const gate = useMutationGate()
  const [confirming, setConfirming] = useState(false)
  if (sessionId === undefined) return <aside className="session-inspector session-inspector--empty"><EmptyState icon={Eye} message="Choose a retained session to inspect identity, events, live view, and action receipts." title="No session selected" /></aside>
  if (session.isPending) return <aside aria-busy="true" aria-label="Loading session detail" className="session-inspector"><div className="skeleton skeleton--short" /><div className="skeleton skeleton--line" /></aside>
  if (session.isError) return <aside className="session-inspector"><InlineNotice message="The session may have expired from the bounded ledger. Return to the list and refresh." title="Session unavailable" tone={NoticeTone.ERROR} /></aside>
  const canRelease = releaseAllowed(session.data.state)
  return (
    <aside className="session-inspector" aria-labelledby="inspector-heading">
      <header className="inspector-heading"><div><span className="eyebrow">Selected session</span><h2 className="mono" id="inspector-heading">{session.data.sessionId}</h2></div><StateLabel state={session.data.state} /></header>
      <div className="inspector-actions">
        <Link className="action-link action-link--primary" to={`/sessions/${sessionId}/live`}><Eye aria-hidden="true" />Open live view</Link>
        <ActionButton disabled={!gate.allowed || !canRelease} icon={RotateCcw} label="Release" onClick={() => setConfirming(true)} variant={ButtonVariant.DESTRUCTIVE} />
      </div>
      <IdentityFacts session={session.data} />
      <LeaseRecovery session={session.data} />
      <BrowserFrameFallback sessionId={sessionId} state={session.data.state} />
      <section className="inspector-section" aria-labelledby="session-events-heading"><div className="panel-heading"><div><h3 id="session-events-heading">Session events</h3><span>Bounded manager ledger</span></div></div><SessionEvents sessionId={sessionId} /></section>
      <McpBinding sessionId={sessionId} />
      <ActionPanel sessionId={sessionId} state={session.data.state} />
      {confirming ? <ReleaseDialog close={() => setConfirming(false)} sessionId={sessionId} /> : null}
    </aside>
  )
}

function IdentityFacts({ session }: Readonly<{ readonly session: NonNullable<ReturnType<typeof useSessionQuery>["data"]> }>) {
  return <dl className="identity-facts"><div><dt>Worker affinity</dt><dd>{session.workerId ?? "Not assigned"}</dd></div><div><dt>Worker generation</dt><dd className="mono" title={session.instanceId}>{session.instanceId ?? "Pending"}</dd></div><div><dt>Created</dt><dd>{formatTimestamp(session.createdAt)}</dd></div><div><dt>Running for</dt><dd>{session.startedAt ? durationSince(session.startedAt) : "Not started"}</dd></div><div><dt>Admission</dt><dd className="mono" title={session.admissionId}>{session.admissionId ?? "Immediate"}</dd></div></dl>
}

function LeaseRecovery({ session }: Readonly<{ readonly session: NonNullable<ReturnType<typeof useSessionQuery>["data"]> }>) {
  return <section className="lease-recovery" aria-labelledby="lease-recovery-heading"><div><span className="eyebrow">Affinity lease</span><h3 id="lease-recovery-heading">Worker generation binding</h3></div><dl><div><dt>Lease target</dt><dd>{session.workerId && session.instanceId ? `${session.workerId} / ${session.instanceId}` : "Awaiting allocation"}</dd></div><div><dt>Lease lifetime</dt><dd>Session lifecycle; no client-side expiry is assumed</dd></div><div><dt>Recovery</dt><dd>{recoveryAdvice(session.state, session.failureCode)}</dd></div></dl></section>
}

function recoveryAdvice(state: SessionState, failureCode: string | undefined): string {
  switch (state) {
    case SessionState.QUEUED: return "Cancel the admission if this work is no longer needed."
    case SessionState.STARTING: return "Wait for manager reconciliation before retrying create."
    case SessionState.LIVE: return "Release the session before reusing this worker slot."
    case SessionState.RELEASING: return "Wait for the worker generation to reconcile idle."
    case SessionState.RELEASED: return "Create a new session; this lease is terminal."
    case SessionState.LOST: return "Create a replacement only after the instance-loss event is confirmed."
    case SessionState.FAILED: return failureCode === undefined ? "Inspect session events before creating a replacement." : `Inspect failure ${failureCode}, then create a replacement.`
    default: return assertNever(state)
  }
}

function BrowserFrameFallback({ sessionId, state }: Readonly<{ readonly sessionId: SessionId; readonly state: SessionState }>) {
  return <section className="browser-frame browser-frame--unavailable" aria-labelledby="browser-frame-heading"><div className="browser-frame__toolbar"><LockKeyhole aria-hidden="true" /><span id="browser-frame-heading">Private browser surface</span><StateLabel state={state} /></div><div className="browser-frame__body"><Eye aria-hidden="true" /><strong>Live view is opt-in</strong><span>The stream is requested only on the dedicated viewer route. No worker origin is exposed.</span><Link to={`/sessions/${sessionId}/live`}>Request same-origin viewer</Link></div></section>
}

function McpBinding({ sessionId }: Readonly<{ readonly sessionId: SessionId }>) {
  const capabilities = useCapabilitiesQuery()
  return <section className="inspector-section" aria-labelledby="mcp-binding-heading"><div className="panel-heading"><div><h3 id="mcp-binding-heading">MCP session binding</h3><span>{capabilities.data ? `Protocol ${capabilities.data.mcp.protocolVersion}` : "Checking contract"}</span></div></div>{capabilities.isError ? <InlineNotice message="The capability contract is currently unavailable." title="MCP status unknown" tone={NoticeTone.WARNING} /> : <dl className="mcp-binding"><div><dt>Endpoint</dt><dd className="mono">{capabilities.data?.mcp.endpoint ?? ApiPath.MCP}</dd></div><div><dt>Session argument</dt><dd className="mono">{sessionId}</dd></div><div><dt>Transport</dt><dd>{capabilities.data?.mcp.stateless === true ? "Stateless" : "Pending"}</dd></div></dl>}</section>
}

function ReleaseDialog({ close, sessionId }: Readonly<{ readonly close: () => void; readonly sessionId: SessionId }>) {
  const release = useReleaseSessionMutation(sessionId)
  const gate = useMutationGate()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    dialog.showModal()
    cancelRef.current?.focus()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  const uncertain = release.error instanceof ManagedApiError && release.error.mutationCertainty === MutationCertainty.INDETERMINATE
  return <dialog aria-labelledby="release-dialog-heading" className="confirm-dialog" onCancel={(event) => { event.preventDefault(); close() }} ref={dialogRef}><h2 id="release-dialog-heading">Release this browser session?</h2><p>The browser is stopped and its worker reconciles before accepting the next admission.</p><span className="mono">{sessionId}</span>{release.isError ? <InlineNotice message={uncertain ? "The release outcome is unknown. Refresh session state before retrying or creating replacement work." : "The manager rejected release. Refresh to confirm current session state."} title={uncertain ? "Release needs reconciliation" : "Release rejected"} tone={NoticeTone.ERROR} /> : null}<div className="dialog-actions"><ActionButton label="Keep session" onClick={close} ref={cancelRef} variant={ButtonVariant.SECONDARY} /><ActionButton disabled={!gate.allowed} label="Release session" loadingLabel="Releasing" onClick={() => release.mutate(undefined, { onSuccess: close })} state={release.isPending ? ConsoleState.LOADING : ConsoleState.READY} variant={ButtonVariant.DESTRUCTIVE} /></div></dialog>
}

function releaseAllowed(state: SessionState): boolean {
  switch (state) {
    case SessionState.LIVE:
    case SessionState.STARTING: return true
    case SessionState.FAILED:
    case SessionState.LOST:
    case SessionState.QUEUED:
    case SessionState.RELEASED:
    case SessionState.RELEASING: return false
    default: return assertNever(state)
  }
}
