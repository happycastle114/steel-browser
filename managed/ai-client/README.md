# Managed AI browser client

`@happycastle/steel-managed-ai-client` is the browser-safe client for the managed Steel AI REST surface. It depends only on `@happycastle/steel-managed-shared/browser` and an injected fetch implementation.

```ts
const client = new SteelManagedAiClient({ baseUrl: "https://steel.soungmin.tech", fetch: window.fetch.bind(window) })
const accepted = await client.submitAction(action)
const result = await client.getResult({ resultId: accepted.resultId })
```

The client validates the selected public origin, generated route inventory, configured tool schemas, result identity, and live-view session binding. MCP remains a server endpoint advertised by `capabilities()`; this package deliberately does not ship an MCP browser transport.
