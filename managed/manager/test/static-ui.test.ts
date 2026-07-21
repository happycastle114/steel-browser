import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import Fastify from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  buildUiAssetManifest,
  loadVerifiedUiAssetManifest,
  writeUiAssetManifest,
} from "../src/ui/asset-manifest.js"
import { registerStaticUi } from "../src/ui/static-ui.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })))
})

describe("sealed manager console assets", () => {
  it("serves only manifest assets and the SPA fallback with immutable digests", async () => {
    const root = await createConsoleRoot()
    const declared = await writeUiAssetManifest(root)
    const manifest = await loadVerifiedUiAssetManifest(root)
    const app = Fastify({ logger: false })
    registerStaticUi(app, { manifest, root })
    await app.ready()

    try {
      const [redirect, index, asset, fallback] = await Promise.all([
        app.inject({ method: "GET", url: "/ui" }),
        app.inject({ method: "GET", url: "/ui/" }),
        app.inject({ method: "GET", url: "/ui/assets/app.123.js" }),
        app.inject({ method: "GET", url: "/ui/sessions/active" }),
      ])

      expect(redirect.statusCode).toBe(302)
      expect(redirect.headers.location).toBe("/ui/")
      expect(index.body).toBe("<!doctype html><main>Steel</main>")
      expect(fallback.body).toBe(index.body)
      expect(asset.body).toBe("globalThis.STEEL=true\n")
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable")
      expect(asset.headers.etag).toBe(`"${declared.files[0]?.sha256}"`)
    } finally {
      await app.close()
    }
  })

  it.each([
    "/ui/%2e%2e/secret.txt",
    "/ui/%2fetc/passwd",
    "/ui/%5c..%5csecret.txt",
    "/ui/..\\secret.txt",
  ])("rejects a traversal-shaped SPA path: %s", async (url) => {
    const root = await createConsoleRoot()
    const manifest = await writeUiAssetManifest(root)
    const app = Fastify({ logger: false })
    registerStaticUi(app, { manifest, root })

    try {
      const response = await app.inject({ method: "GET", url })
      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain("outside-secret")
    } finally {
      await app.close()
    }
  })

  it("rejects asset tampering and undeclared files during startup readback", async () => {
    const root = await createConsoleRoot()
    await writeUiAssetManifest(root)
    await writeFile(path.join(root, "index.html"), "tampered", "utf8")
    await expect(loadVerifiedUiAssetManifest(root)).rejects.toThrow("readback mismatched")

    const secondRoot = await createConsoleRoot()
    await writeUiAssetManifest(secondRoot)
    await writeFile(path.join(secondRoot, "undeclared.txt"), "undeclared", "utf8")
    await expect(loadVerifiedUiAssetManifest(secondRoot)).rejects.toThrow("readback mismatched")
  })

  it("rejects symbolic links instead of following files outside the console root", async () => {
    const root = await createConsoleRoot()
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`)
    temporaryRoots.push(outside)
    await writeFile(outside, "outside-secret", "utf8")
    await symlink(outside, path.join(root, "assets", "escape.txt"))

    await expect(buildUiAssetManifest(root)).rejects.toThrow("symlink rejected")
  })

  it.each(["_showcase/index.js", "fixtures/session.json", "assets/app.js.map"])(
    "rejects a development-only console artifact: %s",
    async (relativePath) => {
      const root = await createConsoleRoot()
      const artifactPath = path.join(root, relativePath)
      await mkdir(path.dirname(artifactPath), { recursive: true })
      await writeFile(artifactPath, "development-only", "utf8")

      await expect(buildUiAssetManifest(root)).rejects.toThrow()
    },
  )
})

async function createConsoleRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "steel-manager-ui-"))
  temporaryRoots.push(root)
  await mkdir(path.join(root, "assets"))
  await writeFile(path.join(root, "index.html"), "<!doctype html><main>Steel</main>", "utf8")
  await writeFile(path.join(root, "assets", "app.123.js"), "globalThis.STEEL=true\n", "utf8")
  return root
}
