import { Play } from "lucide-react"
import { useState, type FormEvent } from "react"

import { useBrowserActionMutation } from "../../api/queries.js"
import { ManagedApiError, MutationCertainty } from "../../api/client.js"
import { useMutationGate } from "../../api/mutation-gate-context.js"
import { BrowserActionInputSchema, type BrowserActionInput } from "../../api/schema-integrations.js"
import type { SessionId } from "../../api/schema-primitives.js"
import { ActionButton, ButtonVariant } from "../../components/ActionButton.js"
import { InlineNotice } from "../../components/InlineNotice.js"
import { ActionKind, BrowserKey, ConsoleState, NoticeTone, ScrapeFormat, ScreenshotFormat, SessionState, assertNever } from "../../domain/vocabulary.js"
import { ActionReceipt } from "./ActionReceipt.js"

const actions = [
  [ActionKind.NAVIGATE, "Navigate"], [ActionKind.SNAPSHOT, "Accessibility snapshot"],
  [ActionKind.SCREENSHOT, "Screenshot"], [ActionKind.SCRAPE, "Scrape"],
  [ActionKind.CLICK, "Click"], [ActionKind.TYPE, "Type"], [ActionKind.KEY, "Press key"],
] as const

export function ActionPanel({ sessionId, state }: Readonly<{ readonly sessionId: SessionId; readonly state: SessionState }>) {
  const [kind, setKind] = useState<ActionKind>(ActionKind.NAVIGATE)
  const [validation, setValidation] = useState<string>()
  const action = useBrowserActionMutation()
  const gate = useMutationGate()
  const enabled = state === SessionState.LIVE && gate.allowed
  const uncertain = action.error instanceof ManagedApiError && action.error.mutationCertainty === MutationCertainty.INDETERMINATE

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let input: BrowserActionInput
    try {
      input = actionInput(kind, sessionId, new FormData(event.currentTarget))
    } catch {
      setValidation("A closed action option was changed outside the console. Reload before submitting.")
      return
    }
    const parsed = BrowserActionInputSchema.safeParse(input)
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? "Review the action fields.")
      return
    }
    setValidation(undefined)
    action.mutate(parsed.data)
  }

  function changeAction(value: string) {
    const next = Object.values(ActionKind).find((candidate) => candidate === value)
    if (next === undefined) {
      setValidation("Select an action from the managed tool registry.")
      return
    }
    setValidation(undefined)
    setKind(next)
  }

  return (
    <section className="action-panel" aria-labelledby="action-heading">
      <div className="panel-heading"><div><h3 id="action-heading">Browser action</h3><span>Explicit session affinity</span></div></div>
      {!enabled ? <InlineNotice message="Browser actions become available only after this session is live." title="Session is not interactive" tone={NoticeTone.INFO} /> : null}
      <form className="action-form" onSubmit={submit}>
        <label><span>Action</span><select disabled={!enabled} onChange={(event) => changeAction(event.currentTarget.value)} value={kind}>{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <ActionFields kind={kind} />
        <ActionButton disabled={!enabled} icon={Play} label="Run action" loadingLabel="Running" state={action.isPending ? ConsoleState.LOADING : ConsoleState.READY} type="submit" variant={ButtonVariant.PRIMARY} />
      </form>
      {validation ? <InlineNotice message={validation} title="Action needs attention" tone={NoticeTone.WARNING} /> : null}
      {action.isError ? <InlineNotice message={uncertain ? "The action outcome is unknown. Refresh session events before submitting another action." : "The manager rejected the action. Session state will be refreshed."} title={uncertain ? "Action needs reconciliation" : "Action rejected"} tone={NoticeTone.ERROR} /> : null}
      {action.data ? <ActionReceipt result={action.data} /> : null}
    </section>
  )
}

function ActionFields({ kind }: Readonly<{ readonly kind: ActionKind }>) {
  switch (kind) {
    case ActionKind.NAVIGATE: return <label><span>URL</span><input autoComplete="url" name="url" placeholder="https://example.com" type="url" /></label>
    case ActionKind.CLICK: return <label><span>CSS selector</span><input name="selector" placeholder="#submit" /></label>
    case ActionKind.TYPE: return <><label><span>CSS selector</span><input name="selector" placeholder="input[name=email]" /></label><label><span>Text</span><textarea name="text" rows={3} /></label><label className="checkbox-field"><input name="clear" type="checkbox" /><span>Clear the field first</span></label></>
    case ActionKind.KEY: return <label><span>Key</span><select name="key">{Object.values(BrowserKey).map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
    case ActionKind.SCRAPE: return <label><span>Format</span><select name="format">{Object.values(ScrapeFormat).map((format) => <option key={format} value={format}>{format}</option>)}</select></label>
    case ActionKind.SCREENSHOT: return <><label><span>Format</span><select name="format">{Object.values(ScreenshotFormat).map((format) => <option key={format} value={format}>{format}</option>)}</select></label><label className="checkbox-field"><input name="fullPage" type="checkbox" /><span>Capture full page</span></label></>
    case ActionKind.SNAPSHOT: return <p className="field-hint">Returns bounded accessibility-tree metadata for the active page.</p>
    default: return assertNever(kind)
  }
}

function actionInput(kind: ActionKind, sessionId: SessionId, form: FormData): BrowserActionInput {
  switch (kind) {
    case ActionKind.NAVIGATE: return { kind, sessionId, url: field(form, "url") }
    case ActionKind.CLICK: return { kind, selector: field(form, "selector"), sessionId }
    case ActionKind.TYPE: return { clear: form.has("clear"), kind, selector: field(form, "selector"), sessionId, text: field(form, "text") }
    case ActionKind.KEY: return { key: parseBrowserKey(field(form, "key")), kind, sessionId }
    case ActionKind.SCRAPE: return { format: parseScrapeFormat(field(form, "format")), kind, sessionId }
    case ActionKind.SCREENSHOT: return { format: parseScreenshotFormat(field(form, "format")), fullPage: form.has("fullPage"), kind, sessionId }
    case ActionKind.SNAPSHOT: return { kind, sessionId }
    default: return assertNever(kind)
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === "string" ? value : ""
}

function parseBrowserKey(value: string): BrowserKey {
  const key = Object.values(BrowserKey).find((candidate) => candidate === value)
  if (key === undefined) throw new TypeError("Unknown browser key")
  return key
}

function parseScrapeFormat(value: string): (typeof ScrapeFormat)[keyof typeof ScrapeFormat] {
  const format = Object.values(ScrapeFormat).find((candidate) => candidate === value)
  if (format === undefined) throw new TypeError("Unknown scrape format")
  return format
}

function parseScreenshotFormat(value: string): (typeof ScreenshotFormat)[keyof typeof ScreenshotFormat] {
  const format = Object.values(ScreenshotFormat).find((candidate) => candidate === value)
  if (format === undefined) throw new TypeError("Unknown screenshot format")
  return format
}
