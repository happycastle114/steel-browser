import { Clock3, Layers3 } from "lucide-react"

import { usePoolQuery, useWorkersQuery } from "../../api/queries.js"
import type { Worker } from "../../api/schema-resources.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { StateLabel } from "../../components/StateLabel.js"
import { NoticeTone } from "../../domain/vocabulary.js"
import { formatDuration } from "../../lib/format.js"

export function CapacityRail() {
  const pool = usePoolQuery()
  const workers = useWorkersQuery()
  if (pool.isPending || workers.isPending) return <CapacityLoading />
  if (pool.isError || workers.isError) return <InlineNotice message="Capacity could not be confirmed. Session controls remain read-only." title="Capacity unavailable" tone={NoticeTone.ERROR} />

  return (
    <section className="capacity" aria-labelledby="capacity-heading">
      <div className="capacity__heading">
        <h2 id="capacity-heading">Capacity</h2>
        <span>{pool.data.counts.physical} private workers</span>
      </div>
      <div className="capacity__workers">
        {workers.data.items.map((worker) => <WorkerSlot key={worker.workerId} worker={worker} />)}
      </div>
      <article className="queue-summary">
        <div className="queue-summary__title"><Layers3 aria-hidden="true" /><h3>Session queue</h3></div>
        <strong>{pool.data.queue.depth}</strong>
        <span>{pool.data.queue.depth === 0 ? "No browser work is waiting" : `Oldest wait ${formatDuration(pool.data.queue.oldestWaitMs)}`}</span>
        <div className="capacity-meter" aria-label={`${pool.data.queue.depth} of ${pool.data.queue.max} queue positions used`} aria-valuemax={pool.data.queue.max} aria-valuemin={0} aria-valuenow={pool.data.queue.depth} role="progressbar">
          <span style={{ inlineSize: `${Math.min(100, (pool.data.queue.depth / Math.max(1, pool.data.queue.max)) * 100)}%` }} />
        </div>
      </article>
    </section>
  )
}

function WorkerSlot({ worker }: Readonly<{ readonly worker: Worker }>) {
  return (
    <article className="worker-slot">
      <div className="worker-slot__heading"><h3>{worker.workerId}</h3><StateLabel state={worker.state} /></div>
      <dl className="worker-slot__facts">
        <div><dt>Browser slot</dt><dd>{worker.sessionId ? "1 / 1" : "0 / 1"}</dd></div>
        <div><dt>Last observed</dt><dd><Clock3 aria-hidden="true" />{formatDuration(Math.max(0, Date.now() - Date.parse(worker.lastSeenAt)))}</dd></div>
      </dl>
      <span className="worker-slot__instance mono" title={worker.instanceId}>{worker.instanceId}</span>
    </article>
  )
}

function CapacityLoading() {
  return (
    <section aria-busy="true" aria-label="Loading browser capacity" className="capacity capacity--loading">
      <div className="skeleton skeleton--short" />
      <div className="skeleton skeleton--line" />
      <div className="skeleton skeleton--line" />
    </section>
  )
}
