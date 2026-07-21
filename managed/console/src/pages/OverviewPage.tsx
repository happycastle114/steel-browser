import { usePoolQuery, useVersionQuery } from "../api/queries.js"
import { InlineNotice } from "../components/InlineNotice.js"
import { NoticeTone } from "../domain/vocabulary.js"
import { CapacityRail } from "../features/overview/CapacityRail.js"
import { EventTimeline } from "../features/overview/EventTimeline.js"
import { MemoryLedgers } from "../features/overview/MemoryLedgers.js"
import { formatTimestamp, shortIdentifier } from "../lib/format.js"

export function OverviewPage() {
  const pool = usePoolQuery()
  const version = useVersionQuery()
  return (
    <main className="route-page" id="main-content">
      <header className="page-heading">
        <div className="page-heading__copy"><h1>Browser operations</h1><p>Two isolated workers, one bounded admission queue, and no public worker endpoints.</p></div>
        {pool.data ? <span className={`manager-mode manager-mode--${pool.data.mode.toLowerCase()}`}>{pool.data.mode}</span> : null}
      </header>
      <CapacityRail />
      {pool.data ? <MemoryLedgers pool={pool.data} /> : null}
      <div className="overview-columns">
        <EventTimeline />
        <section className="overview-panel stack" aria-labelledby="provenance-heading">
          <div className="overview-panel__heading"><h2 id="provenance-heading">Runtime provenance</h2><span>Immutable release</span></div>
          {version.isPending ? <div className="skeleton skeleton--line" /> : version.isError ? <InlineNotice message="Version identity could not be parsed from the manager." title="Provenance unavailable" tone={NoticeTone.ERROR} /> : <VersionFacts version={version.data} />}
        </section>
      </div>
    </main>
  )
}

function VersionFacts({ version }: Readonly<{ readonly version: NonNullable<ReturnType<typeof useVersionQuery>["data"]> }>) {
  return (
    <dl className="provenance-list">
      <div><dt>Managed source</dt><dd className="mono" title={version.managedSha}>{shortIdentifier(version.managedSha)}</dd></div>
      <div><dt>Upstream source</dt><dd className="mono" title={version.upstreamSha}>{shortIdentifier(version.upstreamSha)}</dd></div>
      <div><dt>Browser</dt><dd>{version.browserVersion}</dd></div>
      <div><dt>Manager image</dt><dd className="mono" title={version.managerDigest}>{shortIdentifier(version.managerDigest)}</dd></div>
      <div><dt>Worker image</dt><dd className="mono" title={version.workerDigest}>{shortIdentifier(version.workerDigest)}</dd></div>
      <div><dt>Started</dt><dd>{formatTimestamp(version.startedAt)}</dd></div>
    </dl>
  )
}
