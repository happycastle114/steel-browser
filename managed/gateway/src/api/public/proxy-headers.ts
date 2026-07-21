import type { WorkerPrivateIdentity } from "./proxy.js"

const INTERNAL_HEADER_PREFIXES = ["x-managed-", "x-steel-managed-"] as const

const STRIPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "cf-access-client-id",
  "cf-access-client-secret",
  "cf-access-jwt-assertion",
  "connection",
  "content-length",
  "cookie",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-steel-session-id",
])

const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "www-authenticate",
])

export function workerRequestHeaders(
  headers: Readonly<Record<string, string | undefined>>,
  identity: WorkerPrivateIdentity,
): Readonly<Record<string, string>> {
  const connectionHeaders = nominatedConnectionHeaders(headers)
  const safe: Record<string, string> = {}
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase()
    if (
      value !== undefined &&
      !STRIPPED_REQUEST_HEADERS.has(name) &&
      !connectionHeaders.has(name) &&
      !isManagedInternalHeader(name)
    ) {
      safe[name] = value
    }
  }
  safe["x-managed-pool-id"] = identity.poolId
  safe["x-managed-manager-instance-id"] = identity.managerInstanceId
  return safe
}

export function workerResponseHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<Record<string, string | readonly string[] | undefined>> {
  const connectionHeaders = nominatedConnectionHeaders(headers)
  return Object.fromEntries(
    Object.entries(headers).filter(([rawName]) => {
      const name = rawName.toLowerCase()
      return (
        !STRIPPED_RESPONSE_HEADERS.has(name) &&
        !connectionHeaders.has(name) &&
        !isManagedInternalHeader(name)
      )
    }),
  )
}

export function isManagedInternalHeader(name: string): boolean {
  const normalized = name.toLowerCase()
  return INTERNAL_HEADER_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function nominatedConnectionHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): ReadonlySet<string> {
  const values = Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === "connection")
    .flatMap(([, value]) => value === undefined ? [] : typeof value === "string" ? [value] : value)
  return new Set(
    values.flatMap((value) => value.split(","))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  )
}
