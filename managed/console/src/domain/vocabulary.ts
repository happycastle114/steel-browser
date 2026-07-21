import {
  ADMISSION_STATE,
  BROWSER_KEY,
  EVENT_TYPE,
  MANAGED_ADMISSION_OPERATION,
  MANAGER_MODE,
  MANAGER_MODE_CAUSE,
  RESULT_KIND,
  SCRAPE_FORMAT,
  SCREENSHOT_FORMAT,
  SESSION_STATE,
  TOOL_MUTABILITY,
  TOOL_NAME,
  TOOL_SESSION_REQUIREMENT,
  WORKER_STATE,
  type AdmissionState as SharedAdmissionState,
  type ManagerMode as SharedManagerMode,
  type ManagerModeCause as SharedManagerModeCause,
  type ResultKind as SharedResultKind,
  type SessionState as SharedSessionState,
  type ToolMutability as SharedToolMutability,
  type ToolSessionRequirement as SharedToolSessionRequirement,
  type WorkerState as SharedWorkerState,
} from "@happycastle/steel-managed-shared/browser"

export const AdmissionState = ADMISSION_STATE
export type AdmissionState = SharedAdmissionState
export const BrowserKey = BROWSER_KEY
export type BrowserKey = (typeof BROWSER_KEY)[keyof typeof BROWSER_KEY]
export const EventType = EVENT_TYPE
export const ManagedAdmissionOperation = MANAGED_ADMISSION_OPERATION
export const ManagerMode = MANAGER_MODE
export type ManagerMode = SharedManagerMode
export const ManagerModeCause = MANAGER_MODE_CAUSE
export type ManagerModeCause = SharedManagerModeCause
export const ResultKind = RESULT_KIND
export type ResultKind = SharedResultKind
export const ScrapeFormat = SCRAPE_FORMAT
export const ScreenshotFormat = SCREENSHOT_FORMAT
export const SessionState = SESSION_STATE
export type SessionState = SharedSessionState
export const ToolMutability = TOOL_MUTABILITY
export type ToolMutability = SharedToolMutability
export const ToolSessionRequirement = TOOL_SESSION_REQUIREMENT
export type ToolSessionRequirement = SharedToolSessionRequirement
export const WorkerState = WORKER_STATE
export type WorkerState = SharedWorkerState

export const ConsoleState = {
  EMPTY: "EMPTY",
  ERROR: "ERROR",
  LOADING: "LOADING",
  READY: "READY",
  STALE: "STALE",
} as const
export type ConsoleState = (typeof ConsoleState)[keyof typeof ConsoleState]

export const ActionKind = {
  CLICK: TOOL_NAME.BROWSER_CLICK,
  KEY: TOOL_NAME.BROWSER_KEY,
  NAVIGATE: TOOL_NAME.BROWSER_NAVIGATE,
  SCRAPE: TOOL_NAME.BROWSER_SCRAPE,
  SCREENSHOT: TOOL_NAME.BROWSER_SCREENSHOT,
  SNAPSHOT: TOOL_NAME.BROWSER_SNAPSHOT,
  TYPE: TOOL_NAME.BROWSER_TYPE,
} as const
export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind]

export const NoticeTone = { ERROR: "error", INFO: "info", SUCCESS: "success", WARNING: "warning" } as const
export type NoticeTone = (typeof NoticeTone)[keyof typeof NoticeTone]

export const assertNever = (value: never): never => {
  throw new TypeError(`Unhandled closed contract member: ${String(value)}`)
}
