# Steel Managed Console Design System

## 0. Research Log

- Embedded refs: shortlisted `aside.md`, `sentry.md`, and `linear.app.md` -> picked `taste-skill.md` + `aside.md` + `layout-skill.md` because this is an operational AI-browser app shell that needs Aside's product framing with denser, explicit scroll mechanics.
- Lazyweb: 4 desktop queries, 2 screens viewed -> kept Fingerprint's compact navigation and information hierarchy; rejected BrowserStack's marketing-page composition for the product console.
- Imagen drafts: two original desktop concepts at `/Users/soungmin/.codex/generated_images/019f7733-6021-7691-a745-b46b89b980a5/exec-c86d463e-7f70-4cfc-be8d-f78cc399e903.png` and `managed/console/design/reference-shell.png` -> picked `reference-shell.png` as the reference-fidelity contract because its top rail, scan-friendly table, and inspector preserve more working space than a dark sidebar.
- Design read: an operational app shell for a self-hosted Steel operator and API integrator, with a bright technical-lab language and precise list-detail hierarchy.
- Dials: `DESIGN_VARIANCE=4`, `MOTION_INTENSITY=3`, `VISUAL_DENSITY=8`. Predictability and fast scanning outrank decoration; motion is limited to feedback and state change.

## 1. Atmosphere & Identity

Steel Managed feels like a calm browser operations room: bright, exact, and safe under load. Its signature is the two-slot capacity rail above a scan-friendly session ledger, with the selected browser session opening as a detailed inspection surface. Structural panels remain sharp and quiet; controls use medium squircles; real browser content supplies the only atmospheric imagery. The memorable moment is selecting a session and seeing its immutable worker affinity, live browser surface, lease, event ledger, REST receipt, and MCP state reconcile in one place.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|---|---|---|---|---|
| Canvas | `--surface-canvas` | `#F6F8F6` | `#101512` | App background |
| Primary surface | `--surface-primary` | `#FFFFFF` | `#171D19` | Main panels and controls |
| Secondary surface | `--surface-secondary` | `#EFF3F0` | `#202823` | Table headers and grouped content |
| Selected surface | `--surface-selected` | `#E9F6EE` | `#173225` | Selected session or worker |
| Elevated surface | `--surface-elevated` | `#FFFFFF` | `#252E28` | Inspector overlays and menus |
| Ink | `--text-primary` | `#17201B` | `#F0F5F1` | Titles and body text |
| Secondary text | `--text-secondary` | `#536158` | `#A9B7AD` | Labels and supporting data |
| Tertiary text | `--text-tertiary` | `#5F6C64` | `#839087` | Disabled and low-priority metadata |
| Default border | `--border-default` | `#D8DFDA` | `#354139` | Panel boundaries and controls |
| Subtle border | `--border-subtle` | `#E8ECE9` | `#29322C` | Table and ledger separators |
| Accent 50 | `--accent-50` | `#EAF7EF` | `#14281D` | Soft interactive selection |
| Accent 100 | `--accent-100` | `#CDEBD9` | `#193725` | Hover selection |
| Accent 500 | `--accent-500` | `#147A46` | `#36B66F` | Focus, links, compact indicators |
| Accent 600 | `--accent-600` | `#0D6639` | `#55C989` | Primary action |
| Accent 700 | `--accent-700` | `#07532E` | `#78D8A1` | Pressed action and high contrast text |
| Success | `--status-success` | `#147A46` | `#55C989` | Healthy, active, completed |
| Warning | `--status-warning` | `#9A5A00` | `#F3B759` | Queue pressure, expiring lease |
| Error | `--status-error` | `#B42318` | `#FF8A80` | Failed, destructive, unavailable |
| Info | `--status-info` | `#176B87` | `#62C3E3` | Starting, reconciling, protocol info |
| Browser sky | `--browser-sky` | `#DCEEF7` | `#20333B` | Real browser-frame fallback only |
| Scrim | `--surface-scrim` | `rgb(23 32 27 / 0.48)` | `rgb(0 0 0 / 0.64)` | Modal and drawer backdrop |
| Focus ring | `--focus-ring` | `#147A46` | `#78D8A1` | Keyboard focus outline |

### Rules

- Accent is used only for interactive selection, focus, links, and primary actions.
- Green, amber, red, and blue status color always accompanies a text label or icon; color never carries state alone.
- The application uses one theme per session. It respects `prefers-color-scheme` by default and never inverts an individual section.
- No color outside this table is introduced in product CSS. Extend the table first when a genuine semantic role appears.

## 3. Typography

### Scale

| Level | Token | Size | Weight | Line height | Tracking | Usage |
|---|---|---:|---:|---:|---:|---|
| Page title | `--type-page` | `1.5rem` | 600 | 1.25 | `-0.015em` | Route title |
| Section title | `--type-section` | `1.125rem` | 600 | 1.35 | `-0.01em` | Capacity and inspector sections |
| Component title | `--type-component` | `0.9375rem` | 600 | 1.4 | normal | Cards, groups, table caption |
| Body | `--type-body` | `0.875rem` | 400 | 1.5 | normal | Default product copy |
| UI label | `--type-label` | `0.8125rem` | 550 | 1.4 | normal | Controls and field labels |
| Caption | `--type-caption` | `0.75rem` | 500 | 1.4 | `0.01em` | Metadata and hints |
| Mono | `--type-mono` | `0.75rem` | 450 | 1.55 | normal | IDs, timestamps, JSON receipts |
| Metric | `--type-metric` | `1.375rem` | 600 | 1.2 | `-0.015em` | Capacity and lease values |

### Font Stack

- Primary: `Geist, "SF Pro Text", "Segoe UI", sans-serif`
- Mono: `"Geist Mono", "SFMono-Regular", Consolas, monospace`
- No serif font is used.

### Rules

- Maximum two families. Numeric identifiers and timestamps use Mono.
- Product body text never falls below the Caption size and remains at least 14px for paragraphs.
- IDs use `overflow-wrap: anywhere` in detail views and ellipsis plus accessible full text in dense rows.
- All interface copy is plain, concrete, and action-oriented. No marketing metaphors appear in the console.

## 4. Spacing & Layout

### Base Unit

All spacing intent derives from a 4px base.

| Token | Value | Usage |
|---|---:|---|
| `--space-1` | `0.25rem` | Icon-to-label and dense metadata |
| `--space-2` | `0.5rem` | Inline groups and row cells |
| `--space-3` | `0.75rem` | Compact control padding |
| `--space-4` | `1rem` | Panel padding and standard gaps |
| `--space-5` | `1.25rem` | Inspector groups |
| `--space-6` | `1.5rem` | Major panel padding |
| `--space-8` | `2rem` | Page sections and mobile route spacing |
| `--space-10` | `2.5rem` | Empty-state breathing room |

### Structural Metrics

| Token | Value | Usage |
|---|---:|---|
| `--stroke-hairline` | `0.0625rem` | Panel and control boundaries |
| `--control-min-size` | `2.75rem` | Minimum interactive target size |
| `--content-measure` | `65ch` | Readable paragraph measure |

### Grid and Scroll Ownership

- Max app width: none. The shell fills the available viewport while readable text remains bounded to 65ch.
- Breakpoints: compact below 768px, mid from 768px, wide from 1180px.
- Wide main grid: fluid session ledger plus a clamped inspector between 24rem and 34rem.
- App shell uses `grid-template-rows: auto minmax(0, 1fr)` and `min-block-size: 100dvb`.
- The route body is the single vertical scroll owner. The top navigation and capacity rail remain in normal fixed shell rows.
- A table viewport may own horizontal overflow only for secondary columns at mid widths. Primary actions and selected content never require two-dimensional scrolling.
- At compact width, the list and inspector become separate stacked route states. The primary session content has no horizontal scrollbar.
- Intrinsic grids use `repeat(auto-fit, minmax(min(var(--track-floor), 100%), 1fr))`.
- Content stress is mandatory: empty, long label, long paragraph, unbroken URL, 200 percent zoom, and 375px reflow.

## 5. Components

### App Shell

- **Structure**: skip link, `header` top navigation, capacity region, `main` route body, live-announcement region.
- **Variants**: wide list-detail, mid list plus drawer, compact list or detail route.
- **Spacing**: `--space-3`, `--space-4`, `--space-6`.
- **States**: default, loading bootstrap, connection lost, read-only degraded.
- **Accessibility**: landmarks, one H1, keyboard skip link, restored focus after drawer close.
- **Motion**: inspector enters with opacity and horizontal transform only; instant under reduced motion.
- **Layout**: `scroll-body-shell`; route body owns vertical scroll.

### Capacity Rail

- **Structure**: heading, exactly two worker slot summaries, queue pressure summary.
- **Variants**: healthy, saturated, reconciling, unavailable.
- **Spacing**: `--space-2`, `--space-3`, `--space-4`.
- **States**: default, hover for linked slot, focus, stale, error, loading.
- **Accessibility**: slot names are text; capacity values have units; stale age is announced.
- **Motion**: progress changes use opacity, not width animation.
- **Layout**: intrinsic grid; no generic three-card metric row styling.

### Session Ledger

- **Structure**: caption, search and typed filters, semantic table on wide screens, row-list representation on compact screens, pagination.
- **Variants**: all sessions, active, queued, released, failed.
- **Spacing**: `--space-2`, `--space-3`, `--space-4`.
- **States**: default, row hover, selected, keyboard focus, loading skeleton, empty filtered, fetch error.
- **Accessibility**: sortable headers expose direction; row selection is a real link or button; checkboxes have individual labels; full IDs remain available to assistive technology.
- **Motion**: selection uses tonal and opacity change only.
- **Layout**: `list-detail` on wide screens; session ledger is the fluid list.

### Session Inspector

- **Structure**: session heading, lifecycle actions, immutable identity facts, browser frame, lease, event ledger, REST receipt, MCP status, recovery guidance.
- **Variants**: active, queued, starting, released, failed, stale.
- **Spacing**: `--space-3`, `--space-4`, `--space-5`.
- **States**: default, loading, action pending, action success, inline error, empty selection.
- **Accessibility**: focus moves to inspector heading only after explicit keyboard activation; destructive controls require a named confirmation dialog; status updates use a polite live region.
- **Motion**: drawer transform and opacity only.
- **Layout**: fixed-width detail region at wide sizes, route-level drawer at mid sizes, full-width detail route at compact sizes.

### Browser Frame

- **Structure**: toolbar, URL/title, connection label, real stream or screenshot surface, unavailable fallback.
- **Variants**: live interactive, screenshot-only, reconnecting, unavailable.
- **Spacing**: `--space-2`, `--space-3`.
- **States**: default, focus, loading, empty, error, disconnected.
- **Accessibility**: the viewport has a descriptive title; keyboard capture is opt-in; Escape returns focus to console controls.
- **Motion**: crossfade only when the transport changes.
- **Layout**: `frame` with stable aspect ratio and reserved dimensions to prevent layout shift.

### Action Button

- **Structure**: native button, library icon, label, optional progress text.
- **Variants**: primary, secondary, quiet, destructive.
- **Spacing**: `--space-2`, `--space-3`, `--space-4`.
- **States**: default, hover, active, focus-visible, disabled, loading, success, error.
- **Accessibility**: minimum 44px touch target on compact screens, visible focus, no label wrapping on wide screens.
- **Motion**: active `scale(0.98)` and state opacity at 120ms; no decorative animation.
- **Layout**: `cluster`; wraps as a group before labels wrap.

### State Label

- **Structure**: semantic icon plus state text.
- **Variants**: queued, starting, active, releasing, released, failed, expired, reconciling.
- **Spacing**: `--space-1`, `--space-2`.
- **States**: default, stale, unknown rejected at the typed boundary.
- **Accessibility**: never color-only; state vocabulary matches the shared contract exactly.
- **Motion**: none, except reduced-opacity pulse for a real pending state when reduced motion is not requested.
- **Layout**: `cluster`.

### Event Ledger and Receipt Block

- **Structure**: ordered event list or definition list, timestamp, actor, event, detail, copy control for safe non-secret receipts.
- **Variants**: compact timeline, expanded audit view, JSON receipt.
- **Spacing**: `--space-2`, `--space-3`, `--space-4`.
- **States**: default, loading, empty, partial, error, copied.
- **Accessibility**: ordered reading flow, timestamps include timezone, copied feedback is announced, secrets are never rendered.
- **Motion**: new entries fade in only when live updates are enabled.
- **Layout**: `stack`; receipt text uses `overflow-wrap: anywhere`.

### Primitive Showcase

- **Structure**: dedicated development route rendering every reusable primitive and required state.
- **Variants**: 375px, 768px, and 1280px harness widths; light and dark themes; reduced motion.
- **States**: default, hover, active, focus, disabled, loading, empty, error, stale.
- **Accessibility**: keyboard path, visible focus, axe checks, 200 percent zoom.
- **Motion**: follows each primitive contract.
- **Layout**: intrinsic grid and `stack`; showcase itself never ships in the production navigation.

## 6. Motion & Interaction

| Type | Token | Duration | Easing | Usage |
|---|---|---:|---|---|
| Micro | `--motion-micro` | 120ms | ease-out | Button press, focus feedback |
| Standard | `--motion-standard` | 200ms | cubic-bezier(0.2, 0, 0, 1) | Inspector and menu state |
| Reconcile | `--motion-reconcile` | 240ms | ease-in-out | Live data replacement |

- Motion communicates feedback or a state transition only.
- Only `transform` and `opacity` animate. Capacity bars update without animated width.
- `prefers-reduced-motion: reduce` disables non-essential movement and keeps instant state feedback.
- Live updates never steal focus. Newly inserted events are announced only when relevant to the active action.
- Destructive release or terminate actions require explicit confirmation and preserve the selected session on failure.

## 7. Depth & Surface

### Strategy

Use a restrained mixed strategy: tonal shifts plus hairline borders for structure, with one documented product-frame shadow for the browser surface and elevated inspector menus.

| Token | Value | Usage |
|---|---|---|
| `--shadow-frame` | `0 1px 2px rgb(23 32 27 / 0.06), 0 10px 28px rgb(23 32 27 / 0.08)` | Browser frame only |
| `--shadow-elevated` | `0 8px 24px rgb(23 32 27 / 0.12)` | Menu, dialog, compact drawer |
| `--radius-control` | `0.5rem` | Inputs, buttons, tabs |
| `--radius-panel` | `0.25rem` | Small grouped panels |
| `--radius-frame` | `0.75rem` | Browser frame and modal |
| `--radius-pill` | `999px` | Status or provenance controls only when content is one short line |

- Structural panels remain square or nearly square. Radius communicates component role.
- No outer glow, blur-only glass, or decorative gradient is used.
- The browser preview may use `--browser-sky` only as a loading or disconnected fallback, never as page decoration.

## 8. Accessibility Constraints & Accepted Debt

### Constraints

- Target WCAG 2.2 AA, with 4.5:1 body contrast and 3:1 large-text and component-boundary contrast.
- Every task is keyboard-completable. Focus order follows visual order, and focus is never moved for passive live updates.
- Screen readers receive full session state, worker affinity, lease expiry, queue position, and action result without needing the browser preview.
- Cognitive load stays bounded: one primary action per state, destructive actions separated, plain error recovery, stable navigation, and no disappearing controls.
- Support light/dark preference, reduced motion, 200 percent zoom, 375px reflow, long Korean labels, and unbroken identifiers.
- Personas: operator recovering capacity, API/MCP integrator tracing a receipt, keyboard-only administrator, screen-reader operator, and motion-sensitive operator.

### Accepted Debt

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| None | None | No accessibility or persona debt is accepted at design start. | Any new debt requires explicit user acknowledgement. |
