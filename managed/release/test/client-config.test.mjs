import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("Codex and OpenCode use direct Streamable HTTP with Managed OAuth", async () => {
  const [codex, openCodeBytes] = await Promise.all([
    readFile(new URL("../../../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../../../opencode.json", import.meta.url), "utf8"),
  ])
  const openCode = JSON.parse(openCodeBytes)

  assert.match(codex, /\[mcp_servers\.steel_managed\]/u)
  assert.match(codex, /url = "https:\/\/steel\.soungmin\.tech\/mcp"/u)
  assert.match(codex, /auth = "oauth"/u)
  assert.doesNotMatch(codex, /CF-Access-Client-(?:Id|Secret)/u)
  assert.deepEqual(openCode.mcp.steel_managed, {
    type: "remote",
    url: "https://steel.soungmin.tech/mcp",
    enabled: true,
    timeout: 75000,
  })
  assert.doesNotMatch(openCodeBytes, /CF-Access-Client-(?:Id|Secret)/u)
  assert.equal(/[0-9a-f]{64}/u.test(`${codex}\n${openCodeBytes}`), false)
})
