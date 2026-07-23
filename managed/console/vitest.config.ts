import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export const vitestConfig = defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
    },
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "https://steel.soungmin.tech/ui/" } },
    exclude: ["test/visual/**", "node_modules/**"],
    setupFiles: ["./test/setup.ts"],
  },
})

export default vitestConfig
