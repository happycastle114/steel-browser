import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assertStrictCoreArtifacts, sha256 } from "./corpus-schema.mjs"
import { LOCK_STAGE, validateObservedCorpus } from "./prepare-corpus.mjs"
import { PROTOCOL } from "./runtime-route-source.mjs"

const SHA_PATTERN = /^[0-9a-f]{40}$/u
const UPGRADE_CLASS = Object.freeze({ ROOT_CDP: "ROOT_CDP" })
const MESSAGE_KIND = Object.freeze({ BROWSER_GET_VERSION: "BROWSER_GET_VERSION" })

export function assertBrowserCdpEvidence(verification, runtimeIdentity) {
  const rootRoute = verification.matrix.routes.find((route) => route.protocol === PROTOCOL.WEBSOCKET && route.path === "/" && route.upgradeClass === UPGRADE_CLASS.ROOT_CDP)
  const rootRecord = verification.webSocketRecords.find((record) => record.routeId === rootRoute?.id)
  if (rootRoute === undefined || rootRecord?.opened !== true || rootRecord.messageKind !== MESSAGE_KIND.BROWSER_GET_VERSION) throw new Error("runtime capture does not contain the root CDP Browser.getVersion observation")
  if (typeof runtimeIdentity.browserVersion !== "string" || runtimeIdentity.browserVersion.trim() === "" || /^(?:fixture|fake|unknown)(?:[-/]|$)/iu.test(runtimeIdentity.browserVersion.trim())) throw new Error("runtime capture browser identity is invalid")
}

export async function verifyRuntimeCapture({ captureDirectory, bindingPath, repositoryRoot, sourceSha }) {
  if (!SHA_PATTERN.test(sourceSha)) throw new Error("runtime capture source SHA is invalid")
  const texts = await validateObservedCorpus(captureDirectory, sourceSha, LOCK_STAGE.CORPUS_LOCKED, { repositoryRoot, strict: true })
  const verification = assertStrictCoreArtifacts(texts, sourceSha)
  if (verification.manifest.restRouteCount !== 37 || verification.manifest.webSocketRouteCount !== 5 || verification.restRecords.length !== 37 || verification.webSocketRecords.length !== 5) throw new Error("runtime capture is not the exact 37 REST and 5 WebSocket corpus")
  const runtimeIdentity = JSON.parse(texts.get("runtime-identity.json"))
  assertBrowserCdpEvidence(verification, runtimeIdentity)

  const provenanceText = texts.get("observation-provenance.json")
  const bindingText = await readFile(bindingPath, "utf8")
  if (bindingText !== provenanceText) throw new Error("runtime capture binding differs from observation provenance")
  return { status: "VERIFIED", sourceSha, captureBindingSha256: sha256(Buffer.from(bindingText, "utf8")), restRouteCount: 37, webSocketRouteCount: 5, runtimeVersion: runtimeIdentity.runtimeVersion, browserVersion: runtimeIdentity.browserVersion }
}

async function main() {
  const args = process.argv.slice(2)
  const readArgument = (name) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const values = { captureDirectory: readArgument("--capture-directory"), bindingPath: readArgument("--binding"), repositoryRoot: readArgument("--repository-root"), sourceSha: readArgument("--source-sha") }
  if (Object.values(values).some((value) => value === undefined)) throw new Error("usage: verify-runtime-capture.mjs --capture-directory <path> --binding <path> --repository-root <path> --source-sha <sha>")
  console.log(`UPSTREAM_RUNTIME_CAPTURE_VERIFIED ${JSON.stringify(await verifyRuntimeCapture(values))}`)
}

if (process.argv[1] !== undefined && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "unknown runtime capture verification failure")
    process.exitCode = 1
  })
}
