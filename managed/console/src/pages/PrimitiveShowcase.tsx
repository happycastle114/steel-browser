import { AlertCircle, RefreshCw } from "lucide-react"

import { ActionButton, ButtonVariant } from "../components/ActionButton.js"
import { EmptyState } from "../components/EmptyState.js"
import { InlineNotice } from "../components/InlineNotice.js"
import { StateLabel } from "../components/StateLabel.js"
import { AdmissionState, ConsoleState, NoticeTone, SessionState, WorkerState } from "../domain/vocabulary.js"

const sessionStates = Object.values(SessionState)
const admissionStates = Object.values(AdmissionState)
const workerStates = Object.values(WorkerState)

export function PrimitiveShowcase() {
  return (
    <main className="showcase" id="main-content">
      <header className="showcase__header stack">
        <p className="showcase__eyebrow">Development surface</p>
        <h1>Primitive showcase</h1>
        <p className="content-limiter">Every reusable control and status state is exercised here before it enters the Steel operations console.</p>
      </header>

      <section className="showcase__section stack" aria-labelledby="buttons-heading">
        <h2 id="buttons-heading">Action buttons</h2>
        <div className="showcase__grid">
          <ShowcaseCell label="Default"><ActionButton label="Button" variant={ButtonVariant.SECONDARY} /></ShowcaseCell>
          <ShowcaseCell label="Primary"><ActionButton label="Create session" variant={ButtonVariant.PRIMARY} /></ShowcaseCell>
          <ShowcaseCell label="Focus"><ActionButton autoFocus label="Focused action" variant={ButtonVariant.SECONDARY} /></ShowcaseCell>
          <ShowcaseCell label="Disabled"><ActionButton disabled label="Unavailable" variant={ButtonVariant.SECONDARY} /></ShowcaseCell>
          <ShowcaseCell label="Loading"><ActionButton label="Release" loadingLabel="Releasing" state={ConsoleState.LOADING} variant={ButtonVariant.PRIMARY} /></ShowcaseCell>
          <ShowcaseCell label="Destructive"><ActionButton label="Terminate" variant={ButtonVariant.DESTRUCTIVE} /></ShowcaseCell>
        </div>
      </section>

      <section className="showcase__section stack" aria-labelledby="labels-heading">
        <h2 id="labels-heading">Closed state vocabulary</h2>
        <StateGroup label="Session" states={sessionStates} />
        <StateGroup label="Admission" states={admissionStates} />
        <StateGroup label="Worker" states={workerStates} />
      </section>

      <section className="showcase__section stack" aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">Feedback and recovery</h2>
        <InlineNotice message="The last successful refresh was 18 seconds ago. Actions are paused until current state is confirmed." title="Manager state is stale" tone={NoticeTone.WARNING} />
        <InlineNotice actions={<ActionButton icon={RefreshCw} label="Retry" variant={ButtonVariant.SECONDARY} />} message="The manager returned a bounded transport error. Existing state has not been changed." title="Could not start session" tone={NoticeTone.ERROR} />
        <InlineNotice message="The selected session was released and its worker is reconciling before reuse." title="Release accepted" tone={NoticeTone.SUCCESS} />
      </section>

      <section className="showcase__section showcase__split" aria-label="Loading and empty states">
        <div className="showcase__state stack" aria-busy="true" aria-label="Loading session ledger">
          <h2>Loading</h2>
          <div className="skeleton skeleton--short" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line" />
        </div>
        <div className="showcase__state">
          <EmptyState actionLabel="Clear filters" icon={AlertCircle} message="No sessions match your current worker and lifecycle filters." onAction={() => undefined} title="No matching sessions" />
        </div>
      </section>
    </main>
  )
}

function ShowcaseCell({ children, label }: Readonly<{ readonly children: React.ReactNode; readonly label: string }>) {
  return <div className="showcase__cell"><span>{label}</span>{children}</div>
}

function StateGroup({ label, states }: Readonly<{ readonly label: string; readonly states: readonly (AdmissionState | SessionState | WorkerState)[] }>) {
  return <div className="showcase__state-group"><h3>{label}</h3><div className="cluster">{states.map((state) => <StateLabel key={state} state={state} />)}</div></div>
}
