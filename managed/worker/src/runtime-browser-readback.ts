import { execFile } from "node:child_process"
import { promisify } from "node:util"

const executeFile = promisify(execFile)
const BROWSER_EXECUTABLE = "/usr/bin/chromium" as const
const VERSION_PATTERN = /^Chromium ([0-9]+(?:\.[0-9]+){3})(?: .*)?\n?$/

export async function readProductionBrowserVersion(): Promise<string> {
  const result = await executeFile(BROWSER_EXECUTABLE, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  })
  const matched = VERSION_PATTERN.exec(result.stdout)
  if (matched?.[1] === undefined) {
    throw new TypeError("runtime Chromium version output is not exact")
  }
  return matched[1]
}
