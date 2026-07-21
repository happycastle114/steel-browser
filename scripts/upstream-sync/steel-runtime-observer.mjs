import { execFile, spawn } from "node:child_process"
import { access, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u

function blocked(message) {
  const error = new Error(message)
  error.name = "RuntimeCaptureBlocked"
  error.code = "RUNTIME_CAPTURE_BLOCKED"
  throw error
}

async function waitForHealth(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/health`)
      if (response.ok) return
    } catch {
      // The fixed worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  blocked("Steel worker health endpoint did not become ready")
}

export async function observeSteelRuntime({ repositoryRoot }) {
  const apiEntry = path.join(repositoryRoot, "api", "build", "index.js")
  const imageSubject = path.join(repositoryRoot, ".steel", "worker-image-digest")
  const chromePaths = ["/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  const chromePath = chromePaths.find((candidate) => existsSync(candidate))
  if (chromePath === undefined) blocked("Chrome prerequisite is unavailable")
  try { await access(apiEntry); await access(imageSubject) } catch { blocked("built Steel worker or image subject is unavailable") }
  const workerImageDigest = (await readFile(imageSubject, "utf8")).trim()
  if (!DIGEST_PATTERN.test(workerImageDigest)) blocked("worker image subject is not a pinned digest")
  const port = 39000
  const worker = spawn(process.execPath, [apiEntry], { cwd: repositoryRoot, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production", CHROME_EXECUTABLE_PATH: chromePath }, stdio: "ignore" })
  try {
    await waitForHealth(port, Date.now() + 30_000)
    await execFileAsync(chromePath, ["--version"], { maxBuffer: 1024 * 1024 })
    blocked("complete live protocol corpus runner is unavailable; no receipt is fabricated")
  } finally {
    worker.kill("SIGTERM")
  }
}
