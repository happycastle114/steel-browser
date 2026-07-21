import { readdir } from "node:fs/promises"
import path from "node:path"

const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set(["build", "node_modules"])
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"]

export async function collectTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry): Promise<readonly string[]> => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return EXCLUDED_DIRECTORY_NAMES.has(entry.name) ? [] : collectTypeScriptFiles(entryPath)
    }
    return entry.isFile() && TYPESCRIPT_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [entryPath]
      : []
  }))
  return nested.flat().sort()
}
