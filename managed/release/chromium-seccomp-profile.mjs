import { createHash } from "node:crypto"

export const CHROMIUM_SECCOMP_PROFILE = Object.freeze({
  bundleDeploymentPath: "./chromium-seccomp.json",
  sha256: "cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849",
  sourceDeploymentPath: "./deploy/coolify/chromium-seccomp.json",
  sourceRevision: "ae935a43d9e376e4759548f6b3c6905c7b282333",
  sourceUrl: "https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json",
})

const USER_NAMESPACE_SYSCALLS = Object.freeze(["clone", "setns", "unshare"])

export function verifyChromiumSeccompProfileBytes(bytes) {
  const actualSha256 = createHash("sha256").update(bytes).digest("hex")
  if (actualSha256 !== CHROMIUM_SECCOMP_PROFILE.sha256) {
    throw new TypeError("Chromium seccomp profile digest drift")
  }
  let profile
  try {
    profile = JSON.parse(Buffer.from(bytes).toString("utf8"))
  } catch {
    throw new TypeError("Chromium seccomp profile is not JSON")
  }
  if (!isRecord(profile) || profile.defaultAction !== "SCMP_ACT_ERRNO" || !Array.isArray(profile.syscalls)) {
    throw new TypeError("Chromium seccomp profile default policy drift")
  }
  const namespaceRules = profile.syscalls.filter((entry) =>
    isRecord(entry) && entry.comment === "Allow create user namespaces",
  )
  if (namespaceRules.length !== 1) {
    throw new TypeError("Chromium seccomp user-namespace rule drift")
  }
  const [namespaceRule] = namespaceRules
  if (
    namespaceRule.action !== "SCMP_ACT_ALLOW" ||
    !Array.isArray(namespaceRule.names) ||
    !sameStrings(namespaceRule.names, USER_NAMESPACE_SYSCALLS) ||
    !Array.isArray(namespaceRule.args) ||
    namespaceRule.args.length !== 0 ||
    !isEmptyRecord(namespaceRule.includes) ||
    !isEmptyRecord(namespaceRule.excludes)
  ) {
    throw new TypeError("Chromium seccomp user-namespace permission drift")
  }
  return Object.freeze({ sha256: actualSha256 })
}

function sameStrings(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function isEmptyRecord(value) {
  return isRecord(value) && Object.keys(value).length === 0
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
