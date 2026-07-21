import { Check, Copy } from "lucide-react"
import { useState } from "react"

import { ResultKind, type ActionResult } from "../../api/schema-integrations.js"
import { ActionButton, ButtonVariant } from "../../components/ActionButton.js"
import { assertNever } from "../../domain/vocabulary.js"
import { formatTimestamp } from "../../lib/format.js"

export function ActionReceipt({ result }: Readonly<{ readonly result: ActionResult }>) {
  const [copied, setCopied] = useState(false)
  const receipt = receiptFor(result)
  const json = JSON.stringify(receipt, null, 2)

  async function copyReceipt() {
    await navigator.clipboard.writeText(json)
    setCopied(true)
  }

  return (
    <section className="action-receipt" aria-labelledby="receipt-heading">
      <div className="panel-heading"><div><h3 id="receipt-heading">REST receipt</h3><span>Safe response metadata</span></div><ActionButton icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy"} onClick={() => void copyReceipt()} variant={ButtonVariant.QUIET} /></div>
      <pre><code>{json}</code></pre>
      <span aria-live="polite" className="sr-only">{copied ? "Receipt copied" : ""}</span>
    </section>
  )
}

function receiptFor(result: ActionResult): Readonly<Record<string, boolean | number | string | undefined>> {
  switch (result.kind) {
    case ResultKind.ACTION:
      return { actionId: result.actionId, completedAt: formatTimestamp(result.completedAt), kind: result.kind, sessionId: result.sessionId }
    case ResultKind.NAVIGATION:
      return { completedAt: formatTimestamp(result.completedAt), kind: result.kind, sessionId: result.sessionId, title: result.title, url: result.url }
    case ResultKind.TEXT:
      return { byteLength: result.byteLength, deliveredByteLength: result.deliveredByteLength, format: result.format, kind: result.kind, sessionId: result.sessionId, sha256: result.sha256, truncated: result.truncated }
    case ResultKind.BINARY:
      return { byteLength: result.byteLength, contentType: result.contentType, expiresAt: formatTimestamp(result.expiresAt), kind: result.kind, resultId: result.resultId, sessionId: result.sessionId, sha256: result.sha256 }
    default:
      return assertNever(result)
  }
}
