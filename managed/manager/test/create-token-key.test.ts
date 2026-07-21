import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CreateTokenKeyError,
  CreateTokenKeyFailure,
  loadCreateTokenKeyFile,
} from "../src/secret/create-token-key.js"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })))
})

describe("create-token key file boundary", () => {
  it("loads exact lowercase hex from a no-follow owner-only regular file and zeroizes on destroy", async () => {
    const fixture = await keyFixture("ab".repeat(32))
    const material = await loadCreateTokenKeyFile(fixture.options)

    expect(material.withBytes((bytes) => Buffer.from(bytes).toString("hex"))).toBe("ab".repeat(32))
    expect(material.destroy()).toBe(true)
    expect(material.destroy()).toBe(false)
    expect(() => material.withBytes(() => undefined)).toThrowError(CreateTokenKeyError)
  })

  it("rejects a symbolic link even when its target has valid bytes and metadata", async () => {
    const fixture = await keyFixture("cd".repeat(32))
    const linked = path.join(fixture.root, "linked")
    await symlink(fixture.options.path, linked)

    await expect(loadCreateTokenKeyFile({ ...fixture.options, path: linked })).rejects.toMatchObject({
      code: CreateTokenKeyFailure.FILE,
    })
  })

  it.each(["A".repeat(64), `${"a".repeat(63)}\n`, "a".repeat(65)])(
    "rejects a noncanonical key payload",
    async (payload) => {
      const fixture = await keyFixture(payload)
      await expect(loadCreateTokenKeyFile(fixture.options)).rejects.toBeInstanceOf(CreateTokenKeyError)
    },
  )

  it("rejects group-readable metadata before decoding bytes", async () => {
    const fixture = await keyFixture("ef".repeat(32))
    await chmod(fixture.options.path, 0o440)

    await expect(loadCreateTokenKeyFile(fixture.options)).rejects.toMatchObject({
      code: CreateTokenKeyFailure.METADATA,
    })
  })
})

async function keyFixture(payload: string): Promise<Readonly<{
  options: Readonly<{ expectedGid: number; expectedUid: number; path: string }>
  root: string
}>> {
  const root = await mkdtemp(path.join(tmpdir(), "steel-manager-key-"))
  temporaryRoots.push(root)
  const keyPath = path.join(root, "key")
  await writeFile(keyPath, payload, { encoding: "ascii", mode: 0o400 })
  await chmod(keyPath, 0o400)
  const metadata = await lstat(keyPath)
  return {
    options: { expectedGid: metadata.gid, expectedUid: metadata.uid, path: keyPath },
    root,
  }
}
