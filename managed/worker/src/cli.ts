import {
  productionSupervisorDependencies,
  startManagedWorkerSupervisor,
} from "./supervisor-runtime.js"
import type { SignalControl } from "./shutdown.js"

const nodeSignals: SignalControl = {
  off: (signal, listener) => {
    process.off(signal, listener)
  },
  on: (signal, listener) => {
    process.on(signal, listener)
  },
  setExitCode: (code) => {
    process.exitCode = code
  },
}

const runtime = await startManagedWorkerSupervisor(
  process.env,
  productionSupervisorDependencies(nodeSignals),
)
await runtime.completion
