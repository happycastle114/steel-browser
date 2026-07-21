export const MANAGED_RELEASE_EVIDENCE_MODE = {
  CONFIG_FILE: "CONFIG_FILE",
} as const

export type ManagedReleaseEvidenceMode =
  (typeof MANAGED_RELEASE_EVIDENCE_MODE)[keyof typeof MANAGED_RELEASE_EVIDENCE_MODE]
