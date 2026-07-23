import { defineConfig } from "@playwright/test"

const testPort = Number(process.env["STEEL_CONSOLE_TEST_PORT"] ?? "4173")
if (!Number.isInteger(testPort) || testPort < 1 || testPort > 65_535) {
  throw new TypeError("STEEL_CONSOLE_TEST_PORT must be a valid TCP port")
}
const testServerUrl = `http://127.0.0.1:${testPort}/ui/`
const testUrl = "https://steel.soungmin.tech/ui/"

const viewports = {
  compact: { height: 812, width: 375 },
  mid: { height: 1024, width: 768 },
  reference: { height: 1058, width: 1487 },
  wide: { height: 900, width: 1280 },
} as const

export default defineConfig({
  expect: { timeout: 5_000 },
  outputDir: "../../.omo/evidence/steel-console-ui/playwright",
  projects: Object.entries(viewports).map(([name, viewport]) => ({
    name,
    use: { channel: "chrome", viewport },
  })),
  reporter: [["list"], ["json", { outputFile: "../../.omo/evidence/steel-console-ui/playwright-product-results.json" }]],
  testDir: "test/visual",
  testIgnore: "primitive.spec.ts",
  use: {
    baseURL: testUrl,
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `STEEL_CONSOLE_TEST_PORT=${testPort} tsx test/visual/server.ts`,
    reuseExistingServer: true,
    timeout: 30_000,
    url: testServerUrl,
  },
})
