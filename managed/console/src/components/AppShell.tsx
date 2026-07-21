import { Boxes, Cable, LayoutDashboard, ShieldCheck } from "lucide-react"
import { NavLink, Outlet } from "react-router-dom"

import { ConnectionBanner } from "./ConnectionBanner.js"
import { ErrorBoundary } from "./ErrorBoundary.js"
import { MutationGateBoundary } from "./MutationGateBoundary.js"
import { ThemeSelector } from "./ThemeSelector.js"

const navigation = [
  { icon: LayoutDashboard, label: "Overview", to: "/" },
  { icon: Boxes, label: "Sessions", to: "/sessions" },
  { icon: Cable, label: "Integrations", to: "/integrations" },
] as const

export function AppShell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to managed operations</a>
      <header className="topbar">
        <a className="brand" href="/ui/" aria-label="Steel Managed Console home">
          <ShieldCheck aria-hidden="true" />
          <span>Steel Managed</span>
        </a>
        <nav aria-label="Primary navigation" className="topbar__nav">
          {navigation.map(({ icon: Icon, label, to }) => (
            <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link--active" : ""}`} end={to === "/"} key={to} to={to}>
              <Icon aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__tools">
          <ThemeSelector />
          <span className="auth-boundary">Access protected</span>
        </div>
      </header>
      <MutationGateBoundary>
        <div className="connection-region"><ConnectionBanner /></div>
        <div className="route-scroll-owner">
          <ErrorBoundary><Outlet /></ErrorBoundary>
          <footer className="legal-footer">
            <span>Apache-2.0 managed fork</span>
            <a href="https://github.com/steel-dev/steel-browser" rel="noreferrer" target="_blank">Upstream steel-dev/steel-browser</a>
          </footer>
        </div>
      </MutationGateBoundary>
      <div aria-atomic="true" aria-live="polite" className="sr-only" id="console-announcer" />
    </div>
  )
}
