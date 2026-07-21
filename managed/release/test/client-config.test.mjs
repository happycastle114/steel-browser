import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("Codex and OpenCode use direct Streamable HTTP with environment-backed Access headers", async () => {
  const [codex, openCodeBytes] = await Promise.all([
    readFile(new URL("../../../.codex/config.toml", import.meta.url), "utf8"),
    readFile(new URL("../../../opencode.json", import.meta.url), "utf8"),
  ])
  const openCode = JSON.parse(openCodeBytes)

  assert.match(codex, /\[mcp_servers\.steel_managed\]/u)
  assert.match(codex, /url = "https:\/\/steel\.soungmin\.tech\/mcp"/u)
  assert.match(codex, /"CF-Access-Client-Id" = "STEEL_CF_ACCESS_CLIENT_ID"/u)
  assert.match(codex, /"CF-Access-Client-Secret" = "STEEL_CF_ACCESS_CLIENT_SECRET"/u)
  assert.deepEqual(openCode.mcp.steel_managed, {
    type: "remote",
    url: "https://steel.soungmin.tech/mcp",
    enabled: true,
    oauth: false,
    headers: {
      "CF-Access-Client-Id": "{env:STEEL_CF_ACCESS_CLIENT_ID}",
      "CF-Access-Client-Secret": "{env:STEEL_CF_ACCESS_CLIENT_SECRET}",
    },
    timeout: 75000,
  })
  assert.equal(/[0-9a-f]{64}/u.test(`${codex}\n${openCodeBytes}`), false)
})
