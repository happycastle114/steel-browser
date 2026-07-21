import { Braces, Cable, CheckCircle2 } from "lucide-react"

import { ApiPath } from "../api/client.js"
import { useCapabilitiesQuery, useToolsQuery } from "../api/queries.js"
import { InlineNotice } from "../components/InlineNotice.js"
import { NoticeTone } from "../domain/vocabulary.js"
import { ToolMutability } from "../api/schema-integrations.js"
import { shortIdentifier } from "../lib/format.js"

const HttpMethod = { GET: "GET", POST: "POST" } as const
const endpoints = [
  [HttpMethod.GET, ApiPath.CAPABILITIES, "Discover versions, limits, and tool hashes"],
  [HttpMethod.GET, ApiPath.TOOLS, "Fetch dereferenced tool schemas"],
  [HttpMethod.POST, ApiPath.ACTIONS, "Run one versioned action envelope"],
  [HttpMethod.GET, `${ApiPath.RESULTS}/:id`, "Download a bounded binary result"],
  [HttpMethod.POST, ApiPath.MCP, "Call stateless MCP over the public origin"],
] as const

export function IntegrationsPage() {
  const capabilities = useCapabilitiesQuery()
  const tools = useToolsQuery()
  return <main className="route-page integrations-page" id="main-content"><header className="page-heading"><div className="page-heading__copy"><h1>AI and REST integrations</h1><p>One same-origin contract for applications, agents, Codex, and OpenCode clients.</p></div></header><div className="integration-summary"><ProtocolCard capabilities={capabilities} /><LimitCard capabilities={capabilities} /></div><section className="integration-panel" aria-labelledby="rest-heading"><div className="panel-heading"><div><h2 id="rest-heading">Public REST surface</h2><span>No private worker origin</span></div><Braces aria-hidden="true" /></div><div className="endpoint-list">{endpoints.map(([method, path, purpose]) => <article key={`${method}:${path}`}><span className={`method method--${method.toLowerCase()}`}>{method}</span><code>{path}</code><p>{purpose}</p></article>)}</div></section><ToolCatalog tools={tools} /></main>
}

type CapabilitiesQuery = ReturnType<typeof useCapabilitiesQuery>
type ToolsQuery = ReturnType<typeof useToolsQuery>

function ProtocolCard({ capabilities }: Readonly<{ readonly capabilities: CapabilitiesQuery }>) {
  return <section className="protocol-card" aria-labelledby="mcp-heading"><div><Cable aria-hidden="true" /><h2 id="mcp-heading">MCP</h2></div>{capabilities.isPending ? <div className="skeleton skeleton--line" /> : capabilities.isError ? <InlineNotice message="Capability discovery failed. Do not assume MCP compatibility." title="MCP status unavailable" tone={NoticeTone.ERROR} /> : <dl><div><dt>Status</dt><dd><CheckCircle2 aria-hidden="true" />Contract ready</dd></div><div><dt>Endpoint</dt><dd><code>{capabilities.data.mcp.endpoint}</code></dd></div><div><dt>Protocol</dt><dd><code>{capabilities.data.mcp.protocolVersion}</code></dd></div><div><dt>Mode</dt><dd>{capabilities.data.mcp.stateless ? "Stateless" : "Stateful"}</dd></div></dl>}</section>
}

function LimitCard({ capabilities }: Readonly<{ readonly capabilities: CapabilitiesQuery }>) {
  return <section className="protocol-card" aria-labelledby="limits-heading"><div><Braces aria-hidden="true" /><h2 id="limits-heading">Bounded request limits</h2></div>{capabilities.data ? <dl><div><dt>Concurrent actions</dt><dd>{capabilities.data.limits.actionCount}</dd></div><div><dt>Action timeout</dt><dd>{capabilities.data.limits.actionTimeoutMs} ms</dd></div><div><dt>Result retention</dt><dd>{capabilities.data.limits.resultCount} objects</dd></div><div><dt>Text result</dt><dd>{capabilities.data.limits.textBytes} bytes</dd></div></dl> : <div className="skeleton skeleton--line" />}</section>
}

function ToolCatalog({ tools }: Readonly<{ readonly tools: ToolsQuery }>) {
  return <section className="integration-panel" aria-labelledby="tools-heading"><div className="panel-heading"><div><h2 id="tools-heading">Tool registry</h2><span>{tools.data?.tools.length ?? 0} versioned tools</span></div></div>{tools.isPending ? <div aria-busy="true" className="tool-grid"><div className="skeleton skeleton--line" /><div className="skeleton skeleton--line" /></div> : tools.isError ? <InlineNotice message="The manager did not return a schema registry. Client generation should stop." title="Tool discovery unavailable" tone={NoticeTone.ERROR} /> : <div className="tool-grid">{tools.data.tools.map((tool) => <article key={tool.name}><div><code>{tool.name}</code><span className={`tool-mutability tool-mutability--${tool.mutability.toLowerCase()}`}>{tool.mutability === ToolMutability.READ ? "Read" : "Write"}</span></div><dl><div><dt>Version</dt><dd>{tool.version}</dd></div><div><dt>Session</dt><dd>{tool.sessionRequirement.toLowerCase()}</dd></div><div><dt>Input schema</dt><dd className="mono" title={tool.inputSchemaSha256}>{shortIdentifier(tool.inputSchemaSha256)}</dd></div><div><dt>Output schema</dt><dd className="mono" title={tool.outputSchemaSha256}>{shortIdentifier(tool.outputSchemaSha256)}</dd></div></dl></article>)}</div>}</section>
}
