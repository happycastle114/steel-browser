import { readFile } from "node:fs/promises"
import path from "node:path"

export const GATE = Object.freeze({
  UPSTREAM_CORPUS: "UPSTREAM_CORPUS",
  MANAGED: "MANAGED",
  ROOT_TEST: "ROOT_TEST",
  ROOT_BUILD: "ROOT_BUILD",
  RAW_STATE: "RAW_STATE",
})

export const OPERATION = Object.freeze({
  PROCESS: "PROCESS",
  COPY_DIRECTORY: "COPY_DIRECTORY",
  COPY_FILE: "COPY_FILE",
})

const EXACT_GATE_KEYS = Object.freeze(Object.values(GATE).sort())
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./:@-]+$/u

function assertExactKeys(value, expected, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${name} keys are not exact`)
  }
}

function assertSafeRelativePath(value, name) {
  if (typeof value !== "string" || !SAFE_RELATIVE_PATH.test(value)) throw new Error(`${name} is not a safe relative path`)
}

export async function loadReviewedGateManifest(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, ".github", "managed-gate-manifest.json")
  const value = JSON.parse(await readFile(manifestPath, "utf8"))
  assertExactKeys(value, ["schemaVersion", "packageScripts", "gates"], "gate manifest")
  if (value.schemaVersion !== 1) throw new Error("gate manifest schema version is unsupported")
  assertExactKeys(value.gates, EXACT_GATE_KEYS, "gate manifest gates")
  if (value.packageScripts === null || typeof value.packageScripts !== "object" || Array.isArray(value.packageScripts)) throw new Error("gate package scripts must be an object")
  for (const [packagePath, scripts] of Object.entries(value.packageScripts)) {
    assertSafeRelativePath(packagePath, "package manifest path")
    if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts) || Object.keys(scripts).length === 0) throw new Error("reviewed package scripts must be a non-empty object")
    for (const [scriptName, command] of Object.entries(scripts)) {
      if (scriptName.trim() === "" || typeof command !== "string" || command.trim() === "") throw new Error("reviewed package script is invalid")
    }
  }
  for (const [gate, operations] of Object.entries(value.gates)) {
    if (!Array.isArray(operations) || operations.length === 0) throw new Error(`reviewed gate ${gate} must have operations`)
    for (const operation of operations) {
      if (operation?.operation === OPERATION.PROCESS) {
        assertExactKeys(operation, ["operation", "cwd", "executable", "args"], "process operation")
        assertSafeRelativePath(operation.cwd, "process cwd")
        assertSafeRelativePath(operation.executable, "process executable")
        if (!Array.isArray(operation.args) || operation.args.some((argument) => typeof argument !== "string")) throw new Error("process args are invalid")
      } else if (operation?.operation === OPERATION.COPY_DIRECTORY || operation?.operation === OPERATION.COPY_FILE) {
        assertExactKeys(operation, ["operation", "source", "destination"], "copy operation")
        assertSafeRelativePath(operation.source, "copy source")
        assertSafeRelativePath(operation.destination, "copy destination")
      } else {
        throw new Error("gate operation is not reviewed")
      }
    }
  }
  return value
}
