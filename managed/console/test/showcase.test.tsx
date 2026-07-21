import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AdmissionState, SessionState, WorkerState } from "../src/domain/vocabulary.js"
import { PrimitiveShowcase } from "../src/pages/PrimitiveShowcase.js"

describe("PrimitiveShowcase", () => {
  it("renders every closed contract state through the shared state primitive", () => {
    const { container } = render(<PrimitiveShowcase />)

    const expectedStateCount = Object.keys(AdmissionState).length + Object.keys(SessionState).length + Object.keys(WorkerState).length
    expect(container.querySelectorAll(".state-label")).toHaveLength(expectedStateCount)
  })

  it("contains loading, empty, error, stale, focus, disabled, and destructive states", () => {
    render(<PrimitiveShowcase />)

    expect(screen.getByRole("button", { name: "Releasing" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled()
    expect(screen.getByText("Manager state is stale")).toBeVisible()
    expect(screen.getByText("Could not start session")).toBeVisible()
    expect(screen.getByRole("button", { name: "Terminate" })).toBeVisible()
    expect(screen.getByRole("heading", { name: "No matching sessions" })).toBeVisible()
  })
})
