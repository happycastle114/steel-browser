import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { LOCK_STAGE, parseUpstreamLock } from "./upstream-lock.js"
import {
  CorpusManifestSchema,
  PROTOCOL_KIND,
  RestCorpusEntrySchema,
  RouteMatrixSchema,
  SessionIdVerdictSchema,
  WebSocketCorpusEntrySchema,
} from "./upstream-corpus-model.js"
import {
  CorpusVerificationError,
  sha256,
  verifyCorpusBundle,
  type CorpusBundle,
  type CorpusSource,
  type CorpusVerification,
} from "./upstream-corpus-verifier.js"
import {
  discoverPinnedRuntimeRoutes,
  PINNED_ROUTE_SOURCE_PATHS,
  routeKey,
} from "./upstream-route-source.js"

const LOCK_PATH = "managed/upstream.lock.json"
const ARTIFACT_PATHS = {
  REST: "rest.ndjson",
  ROUTES: "route-matrix.json",
  SESSION: "session-id-verdict.json",
  WEBSOCKET: "websocket.ndjson",
} as const

function corpusDirectory(repositoryRoot: string, upstreamSha: string): string {
  return path.join(repositoryRoot, "managed", "tests", "upstream", upstreamSha)
}

async function readUtf8(filePath: string): Promise<string> {
  return readFile(filePath, "utf8")
}

function parseJson(text: string, artifact: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CorpusVerificationError(`invalid JSON: ${artifact}`, { cause: error })
    }
    throw error
  }
}

function parseNdjsonRecords(text: string, artifact: string): readonly unknown[] {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")
  if (lines.some((line) => line.length === 0)) {
    throw new CorpusVerificationError(`invalid NDJSON records: ${artifact}`)
  }
  return lines.map((line) => parseJson(line, artifact))
}

async function readSources(repositoryRoot: string): Promise<readonly CorpusSource[]> {
  return Promise.all(
    PINNED_ROUTE_SOURCE_PATHS.map(async (sourcePath) => ({
      path: sourcePath,
      text: await readUtf8(path.join(repositoryRoot, sourcePath)),
    })),
  )
}

export async function loadCorpusBundle(repositoryRoot: string): Promise<CorpusBundle> {
  const lockText = await readUtf8(path.join(repositoryRoot, LOCK_PATH))
  const lock = parseUpstreamLock(parseJson(lockText, LOCK_PATH))
  const directory = corpusDirectory(repositoryRoot, lock.upstreamSha)
  const [manifestText, restText, webSocketText, routeMatrixText, sessionIdVerdictText, sources] =
    await Promise.all([
      readUtf8(path.join(directory, "manifest.json")),
      readUtf8(path.join(directory, ARTIFACT_PATHS.REST)),
      readUtf8(path.join(directory, ARTIFACT_PATHS.WEBSOCKET)),
      readUtf8(path.join(directory, ARTIFACT_PATHS.ROUTES)),
      readUtf8(path.join(directory, ARTIFACT_PATHS.SESSION)),
      readSources(repositoryRoot),
    ])
  return {
    lockText,
    manifestText,
    restText,
    webSocketText,
    routeMatrixText,
    sessionIdVerdictText,
    sources,
  }
}

export async function verifyCorpusAtRepository(
  repositoryRoot: string,
): Promise<CorpusVerification> {
  return verifyCorpusBundle(await loadCorpusBundle(repositoryRoot))
}

export async function generateCorpusMetadata(repositoryRoot: string): Promise<void> {
  const lockPath = path.join(repositoryRoot, LOCK_PATH)
  const lockInput = parseUpstreamLock(parseJson(await readUtf8(lockPath), LOCK_PATH))
  const directory = corpusDirectory(repositoryRoot, lockInput.upstreamSha)
  const [restText, webSocketText, routeMatrixText, sessionIdVerdictText, sources] =
    await Promise.all([
      readUtf8(path.join(directory, ARTIFACT_PATHS.REST)),
      readUtf8(path.join(directory, ARTIFACT_PATHS.WEBSOCKET)),
      readUtf8(path.join(directory, ARTIFACT_PATHS.ROUTES)),
      readUtf8(path.join(directory, ARTIFACT_PATHS.SESSION)),
      readSources(repositoryRoot),
    ])

  const matrix = RouteMatrixSchema.parse(parseJson(routeMatrixText, ARTIFACT_PATHS.ROUTES))
  const verdict = SessionIdVerdictSchema.parse(
    parseJson(sessionIdVerdictText, ARTIFACT_PATHS.SESSION),
  )
  const restRecords = parseNdjsonRecords(restText, ARTIFACT_PATHS.REST).map((record) =>
    RestCorpusEntrySchema.parse(record),
  )
  const webSocketRecords = parseNdjsonRecords(webSocketText, ARTIFACT_PATHS.WEBSOCKET).map(
    (record) => WebSocketCorpusEntrySchema.parse(record),
  )
  const discoveredKeys = discoverPinnedRuntimeRoutes(sources).map(routeKey)
  const manifest = CorpusManifestSchema.parse({
    schemaVersion: 1,
    upstreamSha: lockInput.upstreamSha,
    sessionIdMode: verdict.mode,
    sourceInventorySha256: sha256(`${discoveredKeys.join("\n")}\n`),
    sources: sources.map((source) => ({ path: source.path, sha256: sha256(source.text) })),
    artifacts: [
      { path: ARTIFACT_PATHS.REST, sha256: sha256(restText), records: restRecords.length },
      {
        path: ARTIFACT_PATHS.WEBSOCKET,
        sha256: sha256(webSocketText),
        records: webSocketRecords.length,
      },
      { path: ARTIFACT_PATHS.ROUTES, sha256: sha256(routeMatrixText), records: matrix.routes.length },
      { path: ARTIFACT_PATHS.SESSION, sha256: sha256(sessionIdVerdictText), records: 1 },
    ],
    restRouteCount: matrix.routes.filter((route) => route.protocol === PROTOCOL_KIND.REST).length,
    webSocketRouteCount: matrix.routes.filter(
      (route) => route.protocol === PROTOCOL_KIND.WEBSOCKET,
    ).length,
  })
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  const corpusLock = {
    schemaVersion: 1,
    lockStage: LOCK_STAGE.CORPUS_LOCKED,
    upstreamRepository: lockInput.upstreamRepository,
    upstreamSha: lockInput.upstreamSha,
    protocolCorpusSha256: sha256(manifestText),
    sessionIdVerdictSha256: sha256(sessionIdVerdictText),
  }
  await Promise.all([
    writeFile(path.join(directory, "manifest.json"), manifestText, "utf8"),
    writeFile(lockPath, `${JSON.stringify(corpusLock, null, 2)}\n`, "utf8"),
  ])
}
