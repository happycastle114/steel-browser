import type { IncomingMessage } from "node:http"
import type { AuthorizedRequestContext } from "./request-security.js"

export class AuthorizedRequestContextStore {
  private readonly contexts = new WeakMap<IncomingMessage, AuthorizedRequestContext>()

  public set(request: IncomingMessage, context: AuthorizedRequestContext): void {
    this.contexts.set(request, context)
  }

  public require(request: IncomingMessage): AuthorizedRequestContext {
    const context = this.contexts.get(request)
    if (context === undefined) throw new TypeError("authorized request context missing")
    return context
  }
}
