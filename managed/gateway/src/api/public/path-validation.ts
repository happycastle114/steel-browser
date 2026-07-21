const VALIDATION_ORIGIN = "https://managed.invalid"
const MAX_DECODE_PASSES = 3

export function canonicalPublicPathname(pathAndQuery: string): string | undefined {
  if (
    !pathAndQuery.startsWith("/") ||
    pathAndQuery.startsWith("//") ||
    pathAndQuery.includes("#")
  ) return undefined
  const rawPathname = pathAndQuery.split("?", 1)[0] ?? ""
  let parsed: URL
  try {
    parsed = new URL(pathAndQuery, VALIDATION_ORIGIN)
  } catch {
    return undefined
  }
  if (parsed.origin !== VALIDATION_ORIGIN || parsed.pathname !== rawPathname) return undefined
  return hasTraversalSegment(rawPathname) ? undefined : rawPathname
}

function hasTraversalSegment(pathname: string): boolean {
  return pathname.slice(1).split("/").some((segment) => {
    let decoded = segment
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
      try {
        const next = decodeURIComponent(decoded)
        if (next === decoded) break
        decoded = next
      } catch {
        return true
      }
    }
    return decoded.split(/[\\/]/u).some((part) => part === "." || part === "..")
  })
}
