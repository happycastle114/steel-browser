# Steel Managed Frontend State

## Current Objective

Build a maintainable managed Steel operations console for multiple sessions, exactly two private browser workers, REST action receipts, and MCP visibility, then ship it inside the Coolify manager surface.

## Locked Decisions

- Existing Coolify is the only deployment target. No K3s, Synology VMM, alternate host, or public worker listener.
- The active managed project has one manager and exactly two private worker endpoints. The sibling project is stopped cold standby.
- UI contracts consume typed gateway data. UI state names never invent a second lifecycle vocabulary.
- The selected design direction is the bright technical-lab shell in `managed/console/design/reference-shell.png`.
- `DESIGN.md` is the visual source of truth. No raw visual tokens bypass it.
- No copied logos, proprietary screenshots, or third-party UI assets ship.

## Source Inputs

- Plans: `/Users/soungmin/Documents/Project/k3s-happycastle/.omo/plans/steel-managed-control-plane.md` and `/Users/soungmin/Documents/Project/k3s-happycastle/.omo/plans/steel-managed-coolify-cold-standby.md`.
- Design system: `/Users/soungmin/Documents/Project/steel-browser-console-ui/DESIGN.md`.
- Embedded references: frontend `taste-skill.md`, `aside.md`, and `layout-skill.md`.
- Shipped-product research: Lazyweb BrowserStack and Fingerprint captures viewed locally; only Fingerprint's compact navigation and hierarchy were retained.
- Imagen reference: `/Users/soungmin/Documents/Project/steel-browser-console-ui/managed/console/design/reference-shell.png`.

## Design Brief

- Primary journey: find a session, understand its state and immutable worker affinity, inspect the browser, act safely, and verify the resulting event and receipt.
- Secondary journey: understand two-slot capacity and queue pressure without reading logs.
- Integration journey: verify REST capability/action contracts and MCP protocol/tool availability without exposing secrets.
- Tone: plain, technical, calm, and reversible.
- Anti-references: generic purple SaaS, marketing hero inside the app, card-wall dashboards, fake terminals, decoration-only status dots, pill overload, and motion without state meaning.

## Inclusive Personas

- Mina, self-hosted operator: needs fast capacity diagnosis and safe release/recovery with no hidden worker overlap.
- Joon, AI integration engineer: needs stable action IDs, receipts, MCP protocol state, and copy-safe endpoint details.
- Alex, keyboard-only administrator: needs complete navigation, filtering, row selection, confirmation, and focus restoration without pointer input.
- Sam, screen-reader operator: needs equivalent state and recovery information without interpreting the browser preview.
- Rui, motion-sensitive operator: needs instant, non-animated state feedback under reduced-motion preference.

## Adaptive Preferences

- Respect color scheme and reduced motion.
- Maintain state meaning without color and at 200 percent zoom.
- Reflow primary content at 375px without horizontal scroll.
- Preserve readable Korean and English labels, long URLs, UUIDs, and receipt identifiers.

## Verification Matrix

- Primitive showcase at 375px, 768px, and 1280px for required states.
- Production build tested in a real browser, keyboard path, focus visibility, and axe accessibility checks.
- Visual QA on the same exact build for list, detail, loading, empty, failure, queue pressure, dark theme, reduced motion, long Korean text, and unbroken IDs.
- React tooling gate if React is selected: react-grab and react-scan development-only, react-doctor static review, and proof none reach production.
- Final `review-work` packet includes screenshots, Lighthouse mobile/desktop medians, persona walkthroughs, open findings, and debt status.

## Design Debt Register

| ID | Source | Severity | Issue | Affected users | Suggested fix | Status | Notes |
|---|---|---|---|---|---|---|---|
| None | Design start | None | No deferred issue | None | None | Closed | New Critical or Major findings block completion. |

## Evidence Index

- Research reference: `managed/console/design/reference-shell.png`.
- Primitive QA: `.omo/evidence/steel-console-ui/primitive-{compact,mid,wide}.png`.
- Product QA: `.omo/evidence/steel-console-ui/product-{overview,session}-{compact,mid,wide}.png`.
- Dark theme QA: `.omo/evidence/steel-console-ui/product-integrations-dark-{compact,mid,wide}.png`.
- Lighthouse medians: `.omo/evidence/steel-console-ui/lighthouse-summary.json`.
- Review packet: `.omo/frontend-design/review.md`.

## Handoff Notes

- Primitive and product Chrome gates pass at 375px, 768px, and 1280px.
- The route body is the single vertical scroll owner.
- The console boundary mirrors the pending shared contract with inferred Zod types; replace the compatibility schemas with shared browser-safe exports when the shared-contract branch lands.
- The browser preview is a real upstream stream/screenshot surface or an honest unavailable state, never a div-based fake screenshot.
