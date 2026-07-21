import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AlertCircle } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import { ActionButton } from "../src/components/ActionButton.js"
import { EmptyState } from "../src/components/EmptyState.js"
import { StateLabel } from "../src/components/StateLabel.js"
import { ConsoleState, SessionState } from "../src/domain/vocabulary.js"

describe("ActionButton", () => {
  it("invokes the action when enabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ActionButton label="Retry" onClick={onClick} variant="primary" />)

    await user.click(screen.getByRole("button", { name: "Retry" }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it("announces progress and prevents duplicate activation while loading", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<ActionButton label="Release" loadingLabel="Releasing" onClick={onClick} state={ConsoleState.LOADING} variant="destructive" />)

    const button = screen.getByRole("button", { name: "Releasing" })
    await user.click(button)

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe("StateLabel", () => {
  it("renders state text instead of relying on color", () => {
    render(<StateLabel state={SessionState.LIVE} />)

    expect(screen.getByText("Live")).toBeVisible()
  })
})

describe("EmptyState", () => {
  it("renders concrete recovery content", () => {
    render(<EmptyState actionLabel="Clear filters" icon={AlertCircle} message="No sessions match these filters." onAction={() => undefined} title="No matching sessions" />)

    expect(screen.getByRole("heading", { name: "No matching sessions" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeVisible()
  })
})
