import { Component, type ReactNode } from "react"

import { NoticeTone } from "../domain/vocabulary.js"
import { InlineNotice } from "./InlineNotice.js"

type ErrorBoundaryProps = Readonly<{ readonly children: ReactNode }>
type ErrorBoundaryState = Readonly<{ readonly error?: Error }>

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override readonly state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="fatal-boundary" id="main-content">
          <InlineNotice message="Reload this page. No browser operation was inferred or retried." title="The console could not render this response" tone={NoticeTone.ERROR} />
        </main>
      )
    }
    return this.props.children
  }
}
