import { describe, expect, it } from "vitest"

import { createConsoleQueryClient } from "../src/api/query-client.js"

describe("console mutation scheduling", () => {
  it("never queues an offline mutation for automatic replay after reconnect", () => {
    const client = createConsoleQueryClient()

    expect(client.getDefaultOptions().mutations).toMatchObject({ networkMode: "always", retry: false })
  })
})
