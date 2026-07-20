import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "vitest/config"

const testBrowserProfile = join(
  tmpdir(),
  "steel-managed-worker-tests",
  String(process.pid),
)

export default defineConfig({
  test: {
    env: {
      CHROME_ARGS: "--remote-debugging-port=0",
      CHROME_USER_DATA_DIR: testBrowserProfile,
      NODE_ENV: "development",
    },
  },
})
