import { useParams } from "react-router-dom"

import { SessionIdSchema } from "../api/schema-primitives.js"
import { InlineNotice } from "../components/InlineNotice.js"
import { NoticeTone } from "../domain/vocabulary.js"
import { CapacityRail } from "../features/overview/CapacityRail.js"
import { CreateSessionButton } from "../features/sessions/CreateSessionButton.js"
import { QueueLedger } from "../features/sessions/QueueLedger.js"
import { SessionInspector } from "../features/sessions/SessionInspector.js"
import { SessionLedger } from "../features/sessions/SessionLedger.js"

export function SessionsPage() {
  const params = useParams<{ sessionId: string }>()
  const parsed = params.sessionId === undefined ? undefined : SessionIdSchema.safeParse(params.sessionId)
  const sessionId = parsed?.success === true ? parsed.data : undefined
  return <main className={`route-page sessions-page${sessionId ? " sessions-page--detail" : ""}`} id="main-content"><header className="page-heading"><div className="page-heading__copy"><h1>Sessions and queue</h1><p>Every session keeps immutable affinity to one private worker generation.</p></div><CreateSessionButton /></header>{parsed?.success === false ? <InlineNotice message="The selected route does not contain a valid managed session identifier." title="Invalid session link" tone={NoticeTone.ERROR} /> : null}<CapacityRail /><div className="sessions-workspace"><div className="sessions-list-column"><SessionLedger selectedId={sessionId} /><QueueLedger /></div><SessionInspector sessionId={sessionId} /></div></main>
}
