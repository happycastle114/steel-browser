import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

type CloseHandler = NonNullable<Transport["onclose"]>
type ErrorHandler = NonNullable<Transport["onerror"]>
type MessageHandler = NonNullable<Transport["onmessage"]>

export class SdkTransportAdapter implements Transport {
  private closeHandler: CloseHandler = () => undefined
  private errorHandler: ErrorHandler = () => undefined
  private messageHandler: MessageHandler = () => undefined

  public constructor(private readonly delegate: StreamableHTTPServerTransport) {
    this.delegate.onclose = this.closeHandler
    this.delegate.onerror = this.errorHandler
    this.delegate.onmessage = this.messageHandler
  }

  public get onclose(): CloseHandler {
    return this.closeHandler
  }

  public set onclose(handler: CloseHandler) {
    this.closeHandler = handler
    this.delegate.onclose = handler
  }

  public get onerror(): ErrorHandler {
    return this.errorHandler
  }

  public set onerror(handler: ErrorHandler) {
    this.errorHandler = handler
    this.delegate.onerror = handler
  }

  public get onmessage(): MessageHandler {
    return this.messageHandler
  }

  public set onmessage(handler: MessageHandler) {
    this.messageHandler = handler
    this.delegate.onmessage = handler
  }

  public async start(): Promise<void> {
    await this.delegate.start()
  }

  public async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const relatedRequestId = options?.relatedRequestId
    await this.delegate.send(
      message,
      relatedRequestId === undefined ? undefined : { relatedRequestId },
    )
  }

  public async close(): Promise<void> {
    await this.delegate.close()
  }
}
