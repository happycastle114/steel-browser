import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export const viteConfig = defineConfig({
  base: "/ui/",
  build: {
    assetsDir: "assets",
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: false,
  },
  plugins: [react()],
  server: {
    port: 4173,
  },
})

export default viteConfig
