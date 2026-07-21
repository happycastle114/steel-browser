import { cp, mkdir } from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"

import { GATE, OPERATION, loadReviewedGateManifest } from "./reviewed-gate-manifest.mjs"

function executeProcess(repositoryRoot, operation) {
  const executable = path.join(repositoryRoot, operation.executable)
  const cwd = path.join(repositoryRoot, operation.cwd)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, operation.args, { cwd, env: process.env, stdio: "inherit", shell: false })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolve()
      else reject(new Error(`reviewed process failed: ${operation.executable} code=${String(code)} signal=${String(signal)}`))
    })
  })
}

async function executeCopy(repositoryRoot, operation) {
  const source = path.join(repositoryRoot, operation.source)
  const destination = path.join(repositoryRoot, operation.destination)
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, destination, { recursive: operation.operation === OPERATION.COPY_DIRECTORY, force: true })
}

export async function runReviewedGate(gate, repositoryRoot = process.cwd()) {
  if (!Object.values(GATE).includes(gate)) throw new Error("reviewed gate name is invalid")
  const manifest = await loadReviewedGateManifest(repositoryRoot)
  for (const operation of manifest.gates[gate]) {
    if (operation.operation === OPERATION.PROCESS) await executeProcess(repositoryRoot, operation)
    else await executeCopy(repositoryRoot, operation)
  }
  return { status: "PASSED", gate }
}

const gate = process.argv[2]
runReviewedGate(gate).then((result) => console.log(`REVIEWED_GATE_PASSED ${JSON.stringify(result)}`)).catch((error) => {
  console.error(error instanceof Error ? error.message : "unknown reviewed gate failure")
  process.exitCode = 1
})
