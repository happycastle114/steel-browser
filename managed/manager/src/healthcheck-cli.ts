import { request } from "node:http"
import { pathToFileURL } from "node:url"
import { parseHealthcheckArguments } from "./launch-config.js"

const HEALTHCHECK_TIMEOUT_MILLISECONDS = 2_000

export async function checkLiveness(port = 3_001): Promise<boolean> {
  return new Promise((resolve) => {
    const healthRequest = request(
      {
        agent: false,
        host: "127.0.0.1",
        method: "GET",
        path: "/livez",
        port,
        timeout: HEALTHCHECK_TIMEOUT_MILLISECONDS,
      },
      (response) => {
        response.resume()
        resolve(response.statusCode === 200)
      },
    )
    healthRequest.once("error", () => resolve(false))
    healthRequest.once("timeout", () => healthRequest.destroy())
    healthRequest.end()
  })
}

export async function main(arguments_ = process.argv.slice(2)): Promise<void> {
  parseHealthcheckArguments(arguments_)
  process.exitCode = (await checkLiveness()) ? 0 : 1
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main()
}
