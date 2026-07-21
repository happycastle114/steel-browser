import { get } from "node:http"
import {
  MANAGED_WORKER_RUNTIME,
} from "./image-policy.js"

const HEALTH_TIMEOUT_MS = 2_000

const outgoing = get(
  {
    host: "127.0.0.1",
    path: MANAGED_WORKER_RUNTIME.HEALTH_PATH,
    port: MANAGED_WORKER_RUNTIME.PORT,
    timeout: HEALTH_TIMEOUT_MS,
  },
  (response) => {
    response.resume()
    response.on("end", () => {
      if (response.statusCode !== 200) {
        process.exitCode = 1
      }
    })
  },
)

outgoing.on("timeout", () => {
  process.exitCode = 1
  outgoing.destroy()
})
outgoing.on("error", () => {
  process.exitCode = 1
})
