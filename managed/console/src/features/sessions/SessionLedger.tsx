import { ArrowDown, ArrowUp, Search, SquareArrowOutUpRight } from "lucide-react"
import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { useSessionsQuery } from "../../api/queries.js"
import type { Session } from "../../api/schema-resources.js"
import { EmptyState } from "../../components/EmptyState.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { StateLabel } from "../../components/StateLabel.js"
import { NoticeTone, SessionState, assertNever } from "../../domain/vocabulary.js"
import { durationSince, formatTimestamp, shortIdentifier } from "../../lib/format.js"

const SessionFilter = { SHOW_ACTIVE: "SHOW_ACTIVE", SHOW_ALL: "SHOW_ALL", SHOW_FAILED: "SHOW_FAILED", SHOW_QUEUED: "SHOW_QUEUED", SHOW_RELEASED: "SHOW_RELEASED" } as const
type SessionFilter = (typeof SessionFilter)[keyof typeof SessionFilter]
const SessionSort = { BY_CREATED: "BY_CREATED", BY_SESSION: "BY_SESSION", BY_STATE: "BY_STATE", BY_WORKER: "BY_WORKER" } as const
type SessionSort = (typeof SessionSort)[keyof typeof SessionSort]
const SortDirection = { ASCENDING: "ASCENDING", DESCENDING: "DESCENDING" } as const
type SortDirection = (typeof SortDirection)[keyof typeof SortDirection]

const filters = [
  [SessionFilter.SHOW_ALL, "All"], [SessionFilter.SHOW_ACTIVE, "Active"], [SessionFilter.SHOW_QUEUED, "Queued"],
  [SessionFilter.SHOW_RELEASED, "Released"], [SessionFilter.SHOW_FAILED, "Failed"],
] as const

export function SessionLedger({ selectedId }: Readonly<{ readonly selectedId: string | undefined }>) {
  const sessions = useSessionsQuery()
  const [filter, setFilter] = useState<SessionFilter>(SessionFilter.SHOW_ALL)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SessionSort>(SessionSort.BY_CREATED)
  const [direction, setDirection] = useState<SortDirection>(SortDirection.DESCENDING)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const visible = useMemo(() => [...(sessions.data?.items ?? [])]
    .filter((session) => matchesFilter(session, filter) && matchesSearch(session, search))
    .sort((left, right) => compareSessions(left, right, sort, direction)), [direction, filter, search, sessions.data, sort])

  function changeSort(next: SessionSort) {
    if (sort === next) setDirection((current) => current === SortDirection.ASCENDING ? SortDirection.DESCENDING : SortDirection.ASCENDING)
    else { setSort(next); setDirection(SortDirection.ASCENDING) }
  }

  function toggle(sessionId: string) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })
  }

  return (
    <section className="session-ledger" aria-labelledby="session-ledger-heading">
      <header className="ledger-toolbar"><div><h2 id="session-ledger-heading">Sessions</h2><span>{sessions.data?.items.length ?? 0} on this page</span></div><label className="search-field"><Search aria-hidden="true" /><span className="sr-only">Search sessions</span><input onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search ID or worker" type="search" value={search} /></label></header>
      <div className="filter-tabs" role="group" aria-label="Filter sessions by lifecycle">{filters.map(([value, label]) => <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">{label}</button>)}</div>
      {checked.size > 0 ? <div aria-live="polite" className="ledger-selection"><strong>{checked.size} selected</strong><button onClick={() => setChecked(new Set())} type="button">Clear selection</button></div> : null}
      {sessions.isPending ? <LedgerLoading /> : sessions.isError ? <InlineNotice message="The manager did not return the session ledger." title="Sessions unavailable" tone={NoticeTone.ERROR} /> : visible.length === 0 ? <EmptyState icon={Search} message={sessions.data.items.length === 0 ? "Create a browser session to place work on one of the two private workers." : "No retained session matches the current search and lifecycle filter."} title={sessions.data.items.length === 0 ? "No sessions yet" : "No matching sessions"} /> : <SessionRows changeSort={changeSort} checked={checked} direction={direction} selectedId={selectedId} sessions={visible} sort={sort} toggle={toggle} />}
    </section>
  )
}

type SessionRowsProps = Readonly<{
  readonly changeSort: (sort: SessionSort) => void
  readonly checked: ReadonlySet<string>
  readonly direction: SortDirection
  readonly selectedId: string | undefined
  readonly sessions: readonly Session[]
  readonly sort: SessionSort
  readonly toggle: (sessionId: string) => void
}>

function SessionRows({ changeSort, checked, direction, selectedId, sessions, sort, toggle }: SessionRowsProps) {
  return <><div className="session-table-viewport"><table className="session-table"><caption className="sr-only">Managed sessions with sortable lifecycle and worker columns</caption><thead><tr><th scope="col"><span className="sr-only">Select</span></th><SortHeading active={sort} change={changeSort} direction={direction} label="Session" value={SessionSort.BY_SESSION} /><SortHeading active={sort} change={changeSort} direction={direction} label="State" value={SessionSort.BY_STATE} /><SortHeading active={sort} change={changeSort} direction={direction} label="Worker affinity" value={SessionSort.BY_WORKER} /><SortHeading active={sort} change={changeSort} direction={direction} label="Created" value={SessionSort.BY_CREATED} /><th scope="col"><span className="sr-only">Open</span></th></tr></thead><tbody>{sessions.map((session) => <tr className={selectedId === session.sessionId ? "session-row--selected" : undefined} key={session.sessionId}><td><input aria-label={`Select session ${session.sessionId}`} checked={checked.has(session.sessionId)} onChange={() => toggle(session.sessionId)} type="checkbox" /></td><td><Link className="session-id-link mono" title={session.sessionId} to={`/sessions/${session.sessionId}`}>{shortIdentifier(session.sessionId)}</Link></td><td><StateLabel state={session.state} /></td><td>{session.workerId ?? "Pending assignment"}</td><td><time dateTime={session.createdAt}>{durationSince(session.createdAt)} ago</time></td><td><Link aria-label={`Inspect session ${session.sessionId}`} className="row-open-link" to={`/sessions/${session.sessionId}`}><SquareArrowOutUpRight aria-hidden="true" /></Link></td></tr>)}</tbody></table></div><div className="session-cards">{sessions.map((session) => <article className={`session-card${selectedId === session.sessionId ? " session-card--selected" : ""}`} key={session.sessionId}><div><label><input aria-label={`Select session ${session.sessionId}`} checked={checked.has(session.sessionId)} onChange={() => toggle(session.sessionId)} type="checkbox" /><span className="sr-only">Select</span></label><Link className="mono" to={`/sessions/${session.sessionId}`}>{shortIdentifier(session.sessionId)}</Link><StateLabel state={session.state} /></div><dl><div><dt>Worker</dt><dd>{session.workerId ?? "Pending"}</dd></div><div><dt>Created</dt><dd title={formatTimestamp(session.createdAt)}>{durationSince(session.createdAt)} ago</dd></div></dl></article>)}</div></>
}

function SortHeading({ active, change, direction, label, value }: Readonly<{ readonly active: SessionSort; readonly change: (sort: SessionSort) => void; readonly direction: SortDirection; readonly label: string; readonly value: SessionSort }>) {
  const selected = active === value
  return <th aria-sort={selected ? direction === SortDirection.ASCENDING ? "ascending" : "descending" : "none"} scope="col"><button className="sort-heading" onClick={() => change(value)} type="button">{label}{selected ? direction === SortDirection.ASCENDING ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" /> : null}</button></th>
}

function compareSessions(left: Session, right: Session, sort: SessionSort, direction: SortDirection): number {
  const factor = direction === SortDirection.ASCENDING ? 1 : -1
  switch (sort) {
    case SessionSort.BY_CREATED: return factor * (Date.parse(left.createdAt) - Date.parse(right.createdAt))
    case SessionSort.BY_SESSION: return factor * left.sessionId.localeCompare(right.sessionId)
    case SessionSort.BY_STATE: return factor * left.state.localeCompare(right.state)
    case SessionSort.BY_WORKER: return factor * (left.workerId ?? "").localeCompare(right.workerId ?? "")
    default: return assertNever(sort)
  }
}

function matchesFilter(session: Session, filter: SessionFilter): boolean {
  switch (filter) {
    case SessionFilter.SHOW_ALL: return true
    case SessionFilter.SHOW_ACTIVE: return session.state === SessionState.STARTING || session.state === SessionState.LIVE || session.state === SessionState.RELEASING
    case SessionFilter.SHOW_QUEUED: return session.state === SessionState.QUEUED
    case SessionFilter.SHOW_RELEASED: return session.state === SessionState.RELEASED
    case SessionFilter.SHOW_FAILED: return session.state === SessionState.FAILED || session.state === SessionState.LOST
    default: return assertNever(filter)
  }
}

function matchesSearch(session: Session, search: string): boolean {
  const normalized = search.trim().toLocaleLowerCase()
  return normalized.length === 0 || session.sessionId.toLocaleLowerCase().includes(normalized) || session.workerId?.toLocaleLowerCase().includes(normalized) === true
}

function LedgerLoading() {
  return <div aria-busy="true" aria-label="Loading session ledger" className="ledger-loading"><div className="skeleton skeleton--short" />{[0, 1, 2].map((row) => <div className="skeleton skeleton--line" key={row} />)}</div>
}
