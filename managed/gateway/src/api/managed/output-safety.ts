import { RESULT_KIND, type JsonValue } from "@happycastle/steel-managed-shared"

const PUBLIC_URL_PROTOCOL = { HTTP: "http:", HTTPS: "https:" } as const
const PRIVATE_SUFFIXES = [
  ".cluster.local",
  ".example",
  ".internal",
  ".home.arpa",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".localdomain",
  ".onion",
  ".test",
] as const

export function isSafeNavigationOutput(output: JsonValue): boolean {
  if (typeof output !== "object" || output === null || !("kind" in output) ||
    output["kind"] !== RESULT_KIND.NAVIGATION) return true
  if (!("url" in output) || typeof output["url"] !== "string") return false
  let url: URL
  try {
    url = new URL(output["url"])
  } catch {
    return false
  }
  const isWeb = url.protocol === PUBLIC_URL_PROTOCOL.HTTP || url.protocol === PUBLIC_URL_PROTOCOL.HTTPS
  return isWeb && url.username === "" && url.password === "" && isPublicHostname(url.hostname)
}

function isPublicHostname(hostnameInput: string): boolean {
  const hostname = hostnameInput.replace(/^\[|\]$/gu, "").toLowerCase()
  if (hostname.includes(":") || /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(hostname)) return false
  if (hostname === "localhost" || !hostname.includes(".")) return false
  if (PRIVATE_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false
  const first = hostname.split(".")[0]
  return first !== "worker" && first !== "manager" &&
    !/^worker-\d+$/u.test(first ?? "") && !/^manager-\d+$/u.test(first ?? "")
}
