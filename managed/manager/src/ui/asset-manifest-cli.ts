import { pathToFileURL } from "node:url"
import { writeUiAssetManifest } from "./asset-manifest.js"

export async function generateAssetManifest(arguments_: readonly string[]): Promise<void> {
  const [root, ...extra] = arguments_
  if (root === undefined || extra.length !== 0) {
    throw new TypeError("usage: steel-manager-assets <asset-root>")
  }
  const manifest = await writeUiAssetManifest(root)
  process.stdout.write(`${manifest.treeSha256}\n`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await generateAssetManifest(process.argv.slice(2))
}
