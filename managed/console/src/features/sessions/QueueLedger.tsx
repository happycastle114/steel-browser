import { Clock3 } from "lucide-react"

import { useAdmissionsQuery, useCancelAdmissionMutation } from "../../api/queries.js"
import { ManagedApiError, MutationCertainty } from "../../api/client.js"
import { useMutationGate } from "../../api/mutation-gate-context.js"
import type { Admission } from "../../api/schema-resources.js"
import { ActionButton, ButtonVariant } from "../../components/ActionButton.js"
import { EmptyState } from "../../components/EmptyState.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { StateLabel } from "../../components/StateLabel.js"
import { AdmissionState, ConsoleState, NoticeTone } from "../../domain/vocabulary.js"
import { durationSince } from "../../lib/format.js"

export function QueueLedger() {
  const admissions = useAdmissionsQuery()
  if (admissions.isPending) return <section aria-busy="true" aria-label="Loading admission queue" className="queue-ledger"><div className="skeleton skeleton--short" /><div className="skeleton skeleton--line" /></section>
  if (admissions.isError) return <InlineNotice message="Queued admission records could not be loaded." title="Queue unavailable" tone={NoticeTone.ERROR} />
  const queued = admissions.data.items.filter((admission) => admission.state === AdmissionState.QUEUED || admission.state === AdmissionState.RESERVED || admission.state === AdmissionState.STARTING)
  return (
    <section className="queue-ledger" aria-labelledby="queue-ledger-heading">
      <div className="panel-heading"><div><h2 id="queue-ledger-heading">Admission queue</h2><span>FIFO, bounded by the manager</span></div><strong>{queued.length}</strong></div>
      {queued.length === 0 ? <EmptyState icon={Clock3} message="New requests start immediately when either private worker is idle." title="No waiting admissions" /> : <ol className="queue-list">{queued.map((admission) => <QueueRow admission={admission} key={admission.admissionId} />)}</ol>}
    </section>
  )
}

function QueueRow({ admission }: Readonly<{ readonly admission: Admission }>) {
  const cancel = useCancelAdmissionMutation(admission.admissionId)
  const gate = useMutationGate()
  const uncertain = cancel.error instanceof ManagedApiError && cancel.error.mutationCertainty === MutationCertainty.INDETERMINATE
  return (
    <li>
      <div><span className="mono" title={admission.admissionId}>{admission.admissionId}</span><StateLabel state={admission.state} /></div>
      <dl><div><dt>Position</dt><dd>{admission.position ?? "Reserved"}</dd></div><div><dt>Waiting</dt><dd>{durationSince(admission.createdAt)}</dd></div></dl>
      <ActionButton disabled={!gate.allowed || admission.state !== AdmissionState.QUEUED} label="Cancel" loadingLabel="Cancelling" onClick={() => cancel.mutate()} state={cancel.isPending ? ConsoleState.LOADING : ConsoleState.READY} variant={ButtonVariant.QUIET} />
      {cancel.isError ? <InlineNotice message={uncertain ? "The cancel outcome is unknown. Refresh the queue before taking another action." : "The manager rejected cancellation. Refresh to confirm the current admission state."} title={uncertain ? "Cancellation needs reconciliation" : "Cancel rejected"} tone={NoticeTone.ERROR} /> : null}
    </li>
  )
}
