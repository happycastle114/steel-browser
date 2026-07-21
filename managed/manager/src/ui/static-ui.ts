import { createReadStream } from "node:fs"
import path from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"
import type { UiAssetManifest } from "./asset-manifest.js"

const CacheControl = {
  IMMUTABLE: "public, max-age=31536000, immutable",
  REVALIDATE: "no-cache",
} as const
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

type StaticUiOptions = Readonly<{
  manifest: UiAssetManifest
  root: string
}>

export function registerStaticUi(app: FastifyInstance, options: StaticUiOptions): void {
  const index = requireAsset(options.manifest, "index.html")
  app.get("/ui", async (_request, reply) => reply.redirect("/ui/"))
  app.get("/ui/", async (_request, reply) => sendAsset(reply, options.root, index))
  for (const asset of options.manifest.files) {
    if (asset.path === index.path) continue
    app.get(`/ui/${encodeAssetPath(asset.path)}`, async (_request, reply) =>
      sendAsset(reply, options.root, asset),
    )
  }
  app.get("/ui/*", async (request, reply) => {
    if (unsafeFallbackPath(request.url)) return reply.code(404).send()
    return sendAsset(reply, options.root, index)
  })
}

function sendAsset(
  reply: FastifyReply,
  root: string,
  asset: UiAssetManifest["files"][number],
): FastifyReply {
  reply.header("cache-control", asset.path.startsWith("assets/") ? CacheControl.IMMUTABLE : CacheControl.REVALIDATE)
  reply.header("content-length", String(asset.bytes))
  reply.header("content-type", CONTENT_TYPE_BY_EXTENSION[path.extname(asset.path)] ?? "application/octet-stream")
  reply.header("etag", `"${asset.sha256}"`)
  return reply.send(createReadStream(path.join(root, asset.path)))
}

function requireAsset(manifest: UiAssetManifest, selectedPath: string): UiAssetManifest["files"][number] {
  const asset = manifest.files.find((entry) => entry.path === selectedPath)
  if (asset === undefined) throw new TypeError("UI entrypoint missing")
  return asset
}

function encodeAssetPath(assetPath: string): string {
  return assetPath.split("/").map(encodeURIComponent).join("/")
}

function unsafeFallbackPath(requestUrl: string): boolean {
  const [requestPath = ""] = requestUrl.split("?", 1)
  const lower = requestPath.toLowerCase()
  return (
    lower.includes("..") ||
    lower.includes("%00") ||
    lower.includes("%2e") ||
    lower.includes("%2f") ||
    lower.includes("%5c") ||
    lower.includes("\\")
  )
}
