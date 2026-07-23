import { Activity } from "lucide-react"

import { useEventsQuery } from "../../api/queries.js"
import { EventType, type ManagedEvent } from "../../api/schema-events.js"
import type { SessionId } from "../../api/schema-primitives.js"
import { EmptyState } from "../../components/EmptyState.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { formatTimestamp } from "../../lib/format.js"
import { NoticeTone, assertNever } from "../../domain/vocabulary.js"

export function SessionEvents({ sessionId }: Readonly<{ readonly sessionId: SessionId }>) {
  const events = useEventsQuery()
  if (events.isPending) return <div aria-busy="true" aria-label="Loading session events" className="skeleton skeleton--line" />
  if (events.isError) return <InlineNotice message="The event ledger could not be loaded for this session." title="Events unavailable" tone={NoticeTone.ERROR} />
  const matching = events.data.items.filter((event) => "sessionId" in event && event.sessionId === sessionId)
  if (matching.length === 0) return <EmptyState icon={Activity} message="No retained event references this session." title="No session events" />
  return <ol className="session-event-list">{matching.map((event) => <li key={event.eventId}><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time><strong>{event.type}</strong><span>{eventDetail(event)}</span></li>)}</ol>
}

function eventDetail(event: ManagedEvent): string {
  switch (event.type) {
    case EventType.WORKER_STATE_CHANGED:
    case EventType.SESSION_STATE_CHANGED:
    case EventType.ADMISSION_STATE_CHANGED:
      return event.payload.reasonCode ?? `${event.payload.from} → ${event.payload.to}`
    case EventType.CREATE_RECOVERY: return `${event.payload.outcome}: ${event.payload.journalState}`
    case EventType.INSTANCE_LOST: return event.payload.reasonCode
    case EventType.MANAGER_MODE_CHANGED: return `${event.payload.from} → ${event.payload.to}`
    default: return assertNever(event)
  }
}
