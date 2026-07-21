import {
  AlertTriangle,
  Ban,
  Check,
  Circle,
  CircleDot,
  Clock3,
  LoaderCircle,
  Pause,
  ShieldAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react"

import {
  AdmissionState,
  ConsoleState,
  SessionState,
  WorkerState,
  assertNever,
} from "../domain/vocabulary.js"

type StateValue = AdmissionState | ConsoleState | SessionState | WorkerState
type StatePresentation = Readonly<{
  readonly icon: LucideIcon
  readonly label: string
  readonly tone: "error" | "info" | "neutral" | "success" | "warning"
}>

function presentation(state: StateValue): StatePresentation {
  switch (state) {
    case SessionState.LIVE:
    case WorkerState.IDLE:
    case WorkerState.REACHABLE:
    case AdmissionState.ADMITTED:
    case ConsoleState.READY:
      return { icon: Check, label: state === WorkerState.IDLE ? "Idle" : state === WorkerState.REACHABLE ? "Reachable" : state === AdmissionState.ADMITTED ? "Admitted" : state === ConsoleState.READY ? "Current" : "Live", tone: "success" }
    case SessionState.QUEUED:
    case AdmissionState.QUEUED:
      return { icon: Clock3, label: "Queued", tone: "warning" }
    case SessionState.STARTING:
    case AdmissionState.STARTING:
    case WorkerState.STARTING:
    case ConsoleState.LOADING:
      return { icon: LoaderCircle, label: state === ConsoleState.LOADING ? "Loading" : "Starting", tone: "info" }
    case SessionState.RELEASING:
    case WorkerState.RELEASING:
      return { icon: LoaderCircle, label: "Releasing", tone: "info" }
    case SessionState.RELEASED:
      return { icon: Circle, label: "Released", tone: "neutral" }
    case SessionState.FAILED:
    case AdmissionState.FAILED:
    case ConsoleState.ERROR:
      return { icon: AlertTriangle, label: "Failed", tone: "error" }
    case SessionState.LOST:
    case WorkerState.UNREACHABLE:
      return { icon: WifiOff, label: state === SessionState.LOST ? "Lost" : "Unreachable", tone: "error" }
    case AdmissionState.CANCELLED:
      return { icon: Ban, label: "Cancelled", tone: "neutral" }
    case AdmissionState.EXPIRED:
      return { icon: Clock3, label: "Expired", tone: "neutral" }
    case AdmissionState.RESERVED:
    case WorkerState.RESERVED:
      return { icon: CircleDot, label: "Reserved", tone: "info" }
    case WorkerState.DISCOVERED:
      return { icon: Circle, label: "Discovered", tone: "neutral" }
    case WorkerState.LIVE:
      return { icon: CircleDot, label: "Busy", tone: "success" }
    case WorkerState.QUARANTINED:
      return { icon: ShieldAlert, label: "Quarantined", tone: "error" }
    case WorkerState.DRAINING:
      return { icon: Pause, label: "Draining", tone: "warning" }
    case ConsoleState.EMPTY:
      return { icon: Circle, label: "Empty", tone: "neutral" }
    case ConsoleState.STALE:
      return { icon: AlertTriangle, label: "Stale", tone: "warning" }
    default:
      return assertNever(state)
  }
}

export function StateLabel({ state }: Readonly<{ readonly state: StateValue }>) {
  const statePresentation = presentation(state)
  const Icon = statePresentation.icon
  return (
    <span className={`state-label state-label--${statePresentation.tone}`}>
      <Icon aria-hidden="true" className="state-label__icon" />
      {statePresentation.label}
    </span>
  )
}
