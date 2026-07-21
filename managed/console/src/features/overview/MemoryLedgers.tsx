import type { MemoryLedger, Pool } from "../../api/schema-pool.js"
import { formatBytes } from "../../lib/format.js"

const ledgers = [
  ["Result retention", "result"],
  ["Browser actions", "action"],
  ["Live sockets", "webSocket"],
  ["Ingress connections", "ingressConnection"],
  ["Ingress bodies", "ingressBody"],
] as const satisfies readonly (readonly [string, keyof Pick<Pool["memory"], "action" | "ingressBody" | "ingressConnection" | "result" | "webSocket">])[]

export function MemoryLedgers({ pool }: Readonly<{ readonly pool: Pool }>) {
  return (
    <section className="overview-panel stack" aria-labelledby="reservation-heading">
      <div className="overview-panel__heading"><h2 id="reservation-heading">Bounded reservations</h2><span>Manager-enforced</span></div>
      <div className="ledger-grid">
        {ledgers.map(([label, key]) => <Ledger key={key} label={label} ledger={pool.memory[key]} />)}
      </div>
    </section>
  )
}

function Ledger({ label, ledger }: Readonly<{ readonly label: string; readonly ledger: MemoryLedger }>) {
  const percentage = Math.min(100, (ledger.reservedBytes / Math.max(1, ledger.limitBytes)) * 100)
  return (
    <article className="ledger">
      <div className="ledger__heading"><h3>{label}</h3><span>{ledger.reservedCount} / {ledger.limitCount}</span></div>
      <div className="capacity-meter" aria-label={`${formatBytes(ledger.reservedBytes)} of ${formatBytes(ledger.limitBytes)} reserved`} aria-valuemax={ledger.limitBytes} aria-valuemin={0} aria-valuenow={ledger.reservedBytes} role="progressbar"><span style={{ inlineSize: `${percentage}%` }} /></div>
      <span>{formatBytes(ledger.reservedBytes)} of {formatBytes(ledger.limitBytes)}</span>
    </article>
  )
}
