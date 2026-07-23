export const RUNTIME_SCOPE_KIND = {
  CERTIFICATE: "STEEL_MANAGED_RUNTIME_SCOPE",
} as const

export const RUNTIME_SCOPE_PATH = "managed/runtime-scope.json"

export const RUNTIME_SCOPE_POOL = {
  BLUE: "managed-blue",
  GREEN: "managed-green",
} as const

export const RUNTIME_SCOPE_WORKER = {
  BLUE_00: "managed-blue/worker-00",
  BLUE_01: "managed-blue/worker-01",
  GREEN_00: "managed-green/worker-00",
  GREEN_01: "managed-green/worker-01",
} as const

export const RUNTIME_SCOPE_SOURCE_PATH = {
  OVERLAY_DESCRIPTOR: "managed/overlay/descriptor.json",
  UPSTREAM_LOCK: "managed/upstream.lock.json",
  PROTOCOL_CORPUS:
    "managed/tests/upstream/5880b48c1af107219ff3d904edbb8f6b76bea9b6/manifest.json",
  SESSION_ID_VERDICT:
    "managed/tests/upstream/5880b48c1af107219ff3d904edbb8f6b76bea9b6/session-id-verdict.json",
  LICENSE: "LICENSE",
  BROWSER_INPUT: "Dockerfile",
} as const

export const EXCLUDED_LIVE_CLAIM = {
  HOST_CAPACITY: "HOST_CAPACITY",
  LEGACY_IDENTITY: "LEGACY_IDENTITY",
  LIVE_SECRET_BINDING: "LIVE_SECRET_BINDING",
  RUNTIME_IMAGE_DIGESTS: "RUNTIME_IMAGE_DIGESTS",
  RUNTIME_FINGERPRINT: "RUNTIME_FINGERPRINT",
} as const

export const REQUIRED_EXCLUDED_LIVE_CLAIMS = [
  EXCLUDED_LIVE_CLAIM.HOST_CAPACITY,
  EXCLUDED_LIVE_CLAIM.LEGACY_IDENTITY,
  EXCLUDED_LIVE_CLAIM.LIVE_SECRET_BINDING,
  EXCLUDED_LIVE_CLAIM.RUNTIME_IMAGE_DIGESTS,
  EXCLUDED_LIVE_CLAIM.RUNTIME_FINGERPRINT,
] as const
