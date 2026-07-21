import { useEventsQuery } from "../../api/queries.js"
import { EventType, type ManagedEvent } from "../../api/schema-events.js"
import { EmptyState } from "../../components/EmptyState.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { Activity } from "lucide-react"
import { NoticeTone, assertNever } from "../../domain/vocabulary.js"
import { formatTimestamp, shortIdentifier } from "../../lib/format.js"

export function EventTimeline() {
  const events = useEventsQuery()
  if (events.isPending) return <section aria-busy="true" aria-label="Loading manager events" className="overview-panel stack"><div className="skeleton skeleton--short" /><div className="skeleton skeleton--line" /></section>
  if (events.isError) return <InlineNotice message="The bounded event ledger could not be loaded." title="Events unavailable" tone={NoticeTone.ERROR} />
  return (
    <section className="overview-panel stack" aria-labelledby="events-heading">
      <div className="overview-panel__heading"><h2 id="events-heading">Recent manager events</h2><span>Bounded ledger</span></div>
      {events.data.items.length === 0 ? <EmptyState icon={Activity} message="State transitions will appear after the manager observes browser work." title="No events recorded" /> : (
        <ol className="event-timeline">
          {events.data.items.slice(0, 12).map((event) => <EventRow event={event} key={event.eventId} />)}
        </ol>
      )}
    </section>
  )
}

function EventRow({ event }: Readonly<{ readonly event: ManagedEvent }>) {
  return (
    <li>
      <span className="event-timeline__marker" />
      <div><strong>{eventSummary(event)}</strong><span>{event.sessionId ? `Session ${shortIdentifier(event.sessionId)}` : event.workerId ? `Worker ${event.workerId}` : "Manager"}</span></div>
      <time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time>
    </li>
  )
}

function eventSummary(event: ManagedEvent): string {
  switch (event.type) {
    case EventType.WORKER_STATE_CHANGED:
      return `Worker ${event.payload.from.toLowerCase()} → ${event.payload.to.toLowerCase()}`
    case EventType.SESSION_STATE_CHANGED:
      return `Session ${event.payload.from.toLowerCase()} → ${event.payload.to.toLowerCase()}`
    case EventType.ADMISSION_STATE_CHANGED:
      return `Admission ${event.payload.from.toLowerCase()} → ${event.payload.to.toLowerCase()}`
    case EventType.CREATE_RECOVERY:
      return `Create recovery ${event.payload.outcome.toLowerCase()}`
    case EventType.INSTANCE_LOST:
      return "Worker generation changed"
    case EventType.MANAGER_MODE_CHANGED:
      return `Manager ${event.payload.transition.toLowerCase()}`
    default:
      return assertNever(event)
  }
}
