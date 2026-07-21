import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import { App } from "./App.js"
import { createManagedApi } from "./api/client.js"
import { ConsoleProviders } from "./api/context.js"
import { createConsoleQueryClient } from "./api/query-client.js"
import "./styles/tokens.css"
import "./styles/base.css"
import "./styles/primitives.css"
import "./styles/shell.css"
import "./styles/overview.css"
import "./styles/sessions.css"
import "./styles/inspector.css"
import "./styles/integrations.css"
import "./styles/live-view.css"

const enableDevTools = import.meta.env.DEV && import.meta.env["VITE_DISABLE_REACT_DEVTOOLS"] !== "1"
if (enableDevTools) {
  void import("react-grab")
  void import("react-scan")
}

const rootElement = document.querySelector("#root")
if (!(rootElement instanceof HTMLElement)) {
  throw new TypeError("Steel Managed Console root element is missing")
}

const api = createManagedApi()
const queryClient = createConsoleQueryClient()

createRoot(rootElement).render(
  <StrictMode>
    <ConsoleProviders api={api} queryClient={queryClient}>
      <BrowserRouter basename="/ui">
        <App />
      </BrowserRouter>
    </ConsoleProviders>
  </StrictMode>,
)
