import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { PrimitiveShowcase } from "../src/pages/PrimitiveShowcase.js"
import "../src/styles/tokens.css"
import "../src/styles/base.css"
import "../src/styles/primitives.css"
import "../src/styles/showcase.css"

const rootElement = document.querySelector("#root")
if (!(rootElement instanceof HTMLElement)) throw new TypeError("Primitive test root is missing")

createRoot(rootElement).render(<StrictMode><PrimitiveShowcase /></StrictMode>)
