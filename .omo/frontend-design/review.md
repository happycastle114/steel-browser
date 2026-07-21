# Steel Managed Console Review Packet

## Verdict

Pass for integration into the managed Coolify control plane. No Critical or Major UI finding remains.

## Observable surface

- `/ui/`: two-worker capacity, bounded queue pressure, memory ledgers, manager events, and immutable version provenance.
- `/ui/sessions`: searchable/filterable session ledger, compact cards, bounded admission queue, create and cancel controls.
- `/ui/sessions/:id`: immutable worker affinity, honest live-view fallback, session events, MCP binding, browser actions, safe REST receipt, and confirmed release.
- `/ui/sessions/:id/live`: explicit same-origin live-view request, sandboxed viewer, opt-in keyboard focus, and no private worker address.
- `/ui/integrations`: MCP protocol status, public REST routes, bounded limits, and versioned tool schemas.

Production fixtures: none. Playwright response fixtures are confined to `managed/console/test/visual`.

## Verification

| Gate | Result |
|---|---|
| Node 22 unit tests | 11 passed |
| Node 22 production build | Passed; 365.69 kB JS, 29.43 kB CSS |
| Real Chrome Playwright | 12 passed across 375, 768, and 1280 px |
| Axe | Zero violations on overview, detail, integrations, dialog, and recovery states |
| React Doctor | 100; zero warnings |
| Raw state comparison guard | 171 files verified |
| Production asset scan | No react-grab, react-scan, private worker origin, or debug port |
| Lighthouse mobile median | Performance 98, Accessibility 100 |
| Lighthouse desktop median | Performance 100, Accessibility 100 |

## Lane C critique

- Hierarchy: the two-slot capacity rail is the primary operational read; sessions remain the primary working surface and the inspector stays subordinate.
- Responsive behavior: wide list-detail becomes a stacked mid layout and a dedicated compact detail route without horizontal document overflow.
- Interaction: every mutation is explicit; release uses a native modal dialog and restores a safe focus target on cancel.
- Accessibility: landmarks, skip navigation, semantic tables/cards, native fields, progressbar metadata, non-color state labels, dark theme, reduced motion, and 44px controls are present.
- Security language: the UI names the public-origin boundary and never renders a private worker host, internal websocket, secret, or create token.

## Persona walkthroughs

- Operator: capacity, queue pressure, worker generation, events, and safe release are visible without opening logs.
- AI integrator: REST paths, MCP version, tool hashes, explicit session affinity, and redacted receipts are inspectable.
- Keyboard administrator: navigation, filters, action form, native confirmation dialog, and viewer focus opt-in are keyboard reachable.
- Screen-reader operator: session identity, state, worker affinity, queue position, events, and result metadata do not depend on the browser image.
- Motion-sensitive operator: reduced-motion preference disables nonessential transitions and animation is limited to real pending indicators.

## Integration note

The current branch predates the complete shared browser-safe contract exports, so `src/api/schema-*` is a compatibility boundary matching that contract. After the shared-contract branch is merged, replace this boundary with package imports without changing feature components. The deployed live cast remains the final runtime proof owned by the gateway/Coolify integration lane; the console already rejects cross-origin, wrong-session, query-bearing, and fragment-bearing live-view bindings.
