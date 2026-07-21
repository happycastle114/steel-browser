import { ArrowLeft, Keyboard, LockKeyhole } from "lucide-react"
import { useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"

import { useLiveViewMutation, useSessionQuery } from "../api/queries.js"
import { useMutationGate } from "../api/mutation-gate-context.js"
import { SessionIdSchema } from "../api/schema-primitives.js"
import { ActionButton, ButtonVariant } from "../components/ActionButton.js"
import { InlineNotice } from "../components/InlineNotice.js"
import { ConsoleState, NoticeTone, SessionState } from "../domain/vocabulary.js"
import { CastViewer } from "../features/live/CastViewer.js"

export function LiveViewPage() {
  const params = useParams<{ sessionId: string }>()
  const parsed = SessionIdSchema.safeParse(params.sessionId)
  if (!parsed.success) return <main className="route-page" id="main-content"><InlineNotice message="Return to the session ledger and select a valid session." title="Invalid live-view link" tone={NoticeTone.ERROR} /></main>
  return <LiveView sessionId={parsed.data} />
}

function LiveView({ sessionId }: Readonly<{ readonly sessionId: ReturnType<typeof SessionIdSchema.parse> }>) {
  const session = useSessionQuery(sessionId)
  const liveView = useLiveViewMutation()
  const gate = useMutationGate()
  const [capture, setCapture] = useState(false)
  const captureButtonRef = useRef<HTMLButtonElement>(null)

  function releaseKeyboard() {
    setCapture(false)
    requestAnimationFrame(() => captureButtonRef.current?.focus())
  }

  const isLive = session.data?.state === SessionState.LIVE
  return <main className="route-page live-view-page" id="main-content"><header className="live-heading"><div><Link className="back-link" to={`/sessions/${sessionId}`}><ArrowLeft aria-hidden="true" />Session detail</Link><h1>Live browser</h1><span className="mono">{sessionId}</span></div><div className="live-controls"><ActionButton disabled={!liveView.data} icon={Keyboard} label={capture ? "Keyboard captured" : "Capture keyboard"} onClick={() => setCapture(true)} ref={captureButtonRef} variant={ButtonVariant.SECONDARY} /><ActionButton disabled={!gate.allowed || !isLive} icon={LockKeyhole} label="Request live view" loadingLabel="Binding viewer" onClick={() => liveView.mutate(sessionId)} state={liveView.isPending ? ConsoleState.LOADING : ConsoleState.READY} variant={ButtonVariant.PRIMARY} /></div></header>{!isLive && !session.isPending ? <InlineNotice message="Return when the session reaches live state. No viewer was requested." title="Live view unavailable" tone={NoticeTone.WARNING} /> : null}{liveView.isError ? <InlineNotice message="The manager did not provide a validated public cast socket. No private worker address was used." title="Viewer binding failed" tone={NoticeTone.ERROR} /> : null}<section className="live-surface" aria-label="Live browser viewer">{liveView.data ? <CastViewer capture={capture} castWebSocketUrl={liveView.data.castWebSocketUrl} onEscape={releaseKeyboard} /> : <div className="live-surface__empty"><LockKeyhole aria-hidden="true" /><h2>No stream requested</h2><p>The console will request a short-lived, same-origin cast only after explicit activation.</p></div>}</section>{capture ? <InlineNotice message="Press Escape to stop routing keyboard input and return focus to the capture control." title="Keyboard input is routed to the browser" tone={NoticeTone.INFO} /> : null}</main>
}
