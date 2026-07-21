import { type AddressInfo } from "node:net"
import {
  InstanceIdSchema,
  WorkerDescriptorSchema,
  WorkerIdSchema,
} from "@happycastle/steel-managed-gateway"
import { SESSION_STATE, SessionSchema } from "@happycastle/steel-managed-shared"
import { z } from "zod"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocketServer } from "ws"
import { WorkerCdpPageFactory } from "../src/ai/worker-cdp-page.js"

const RequestSchema = z.object({
  id: z.number().int().positive(),
  method: z.string(),
  sessionId: z.string().optional(),
}).passthrough()
const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => new Promise<void>((resolve) => {
    for (const client of server.clients) client.terminate()
    server.close(() => resolve())
  })))
})

describe("worker CDP page factory", () => {
  it("fences the worker generation before attach and after page closure", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    servers.push(server)
    await new Promise<void>((resolve) => server.once("listening", resolve))
    server.on("connection", (socket) => socket.on("message", (raw) => {
      const request = RequestSchema.parse(JSON.parse(raw.toString()))
      const result = request.method === "Target.getTargets"
        ? { targetInfos: [{ targetId: "target-1", type: "page" }] }
        : { sessionId: "target-session" }
      socket.send(JSON.stringify({ id: request.id, result }))
    }))
    const port = listenerPort(server.address())
    const worker = WorkerDescriptorSchema.parse({
      workerId: WorkerIdSchema.parse("worker-00"),
      instanceId: InstanceIdSchema.parse("00000000-0000-4000-8000-000000000201"),
      origin: `http://127.0.0.1:${port}`,
    })
    let fences = 0
    const factory = new WorkerCdpPageFactory({
      commandTimeoutMilliseconds: 1_000,
      connectTimeoutMilliseconds: 1_000,
      identity: {
        managerInstanceId: "00000000-0000-4000-8000-000000000301",
        poolId: "test-pool",
      },
      messageBytes: 4_096,
      resolveWorker: () => worker,
      verifier: { assertCurrent: async () => { fences += 1 } },
    })
    const session = SessionSchema.parse({
      createdAt: new Date(0).toISOString(),
      instanceId: worker.instanceId,
      sessionId: "00000000-0000-4000-8000-000000000101",
      startedAt: new Date(0).toISOString(),
      state: SESSION_STATE.LIVE,
      workerId: worker.workerId,
    })

    const page = await factory.open(session, new AbortController().signal)
    await page.close()

    expect(fences).toBe(3)
  })
})

function listenerPort(address: string | AddressInfo | null): number {
  if (address === null || typeof address === "string") throw new TypeError("listener address missing")
  return address.port
}
