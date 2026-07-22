import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { verifyManagerDockerfile } from "../src/image/dockerfile-policy.js"

const dockerfilePath = fileURLToPath(new URL("../image/Dockerfile", import.meta.url))

describe("managed manager Dockerfile policy", () => {
  it("accepts the checked-in pinned shellless manager image", () => {
    const source = readFileSync(dockerfilePath, "utf8")

    expect(verifyManagerDockerfile(source)).toEqual({
      finalBase: "scratch",
      healthcheck: "/usr/local/bin/steel-manager-healthcheck",
      init: "/usr/local/bin/steel-manager-init",
      publicPort: 3_000,
      runtimeRoot: "scratch",
    })
  })

  it.each([
    [/@sha256:[0-9a-f]{64}/u, ":latest"],
    ["FROM scratch AS production", "FROM node:latest AS production"],
    ["USER 0:0", "USER 10001:10001"],
    ["EXPOSE 3000", "EXPOSE 3000 3001"],
    ["ENTRYPOINT", "VOLUME /var/lib/steel\nENTRYPOINT"],
    ["ENTRYPOINT", "ENV CHROME_BIN=/usr/bin/chromium\nENTRYPOINT"],
    ["ENTRYPOINT", "VOLUME /var/run/docker.sock\nENTRYPOINT"],
    ["asset-manifest-cli.js", "asset-manifest-disabled.js"],
    ["runtime-source-manifest.mjs", "runtime-source-manifest-disabled.mjs"],
    ["runtime-uid=\"10001\"", "runtime-uid=\"0\""],
    ["/runtime-root/run/steel-release-evidence-source", "/runtime-root/run/release-evidence-disabled"],
    ["node managed/security/verify-production-audit.mjs", "node managed/security/missing-production-audit.mjs"],
    ["COPY --from=production-audit-input /production-dependency-audit.json", "# audit receipt removed"],
    ["dev.happycastle.steel.production-audit.sha256=", "dev.happycastle.steel.production-audit.unbound="],
    ["COPY managed/tsconfig.base.json ./managed/tsconfig.base.json", "# shared TypeScript config removed"],
    ["COPY --from=node-build /etc/ssl/certs/ca-certificates.crt", "# CA bundle source removed"],
  ])("rejects a Dockerfile policy mutation", (search, replacement) => {
    const source = readFileSync(dockerfilePath, "utf8")
    const mutated = source.replace(search, replacement)

    expect(mutated).not.toBe(source)
    expect(() => verifyManagerDockerfile(mutated)).toThrow()
  })
})
