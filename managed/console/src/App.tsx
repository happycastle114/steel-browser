import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "./components/AppShell.js"
import { IntegrationsPage } from "./pages/IntegrationsPage.js"
import { LiveViewPage } from "./pages/LiveViewPage.js"
import { OverviewPage } from "./pages/OverviewPage.js"
import { SessionsPage } from "./pages/SessionsPage.js"

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:sessionId" element={<SessionsPage />} />
        <Route path="sessions/:sessionId/live" element={<LiveViewPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}
