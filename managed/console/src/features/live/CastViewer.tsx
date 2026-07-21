import { CircleAlert, MonitorUp } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react"

import { assertNever } from "../../domain/vocabulary.js"
import { pageCastUrl, parseCastMessage, tabDiscoveryUrl, type CastPage } from "./cast-protocol.js"

const CastConnectionState = {
  CONNECTING: "CONNECTING",
  DISCONNECTED: "DISCONNECTED",
  STREAMING: "STREAMING",
  WAITING_FRAME: "WAITING_FRAME",
} as const
type CastConnectionState = (typeof CastConnectionState)[keyof typeof CastConnectionState]

type CastViewerProps = Readonly<{
  readonly capture: boolean
  readonly castWebSocketUrl: string
  readonly onEscape: () => void
}>

export function CastViewer({ capture, castWebSocketUrl, onEscape }: CastViewerProps) {
  const [tabs, setTabs] = useState<readonly CastPage[]>([])
  const [activePageId, setActivePageId] = useState<string>()
  const [frame, setFrame] = useState<string>()
  const [pageUrl, setPageUrl] = useState("Waiting for the active tab")
  const [connection, setConnection] = useState<CastConnectionState>(CastConnectionState.CONNECTING)
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const imageRef = useRef<HTMLImageElement>(null)
  const viewerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (capture) viewerRef.current?.focus()
  }, [capture])

  useEffect(() => {
    const discovery = new WebSocket(tabDiscoveryUrl(castWebSocketUrl))
    discovery.onmessage = (event) => {
      if (typeof event.data !== "string") return
      const message = parseCastMessage(event.data)
      if (message !== undefined && "type" in message && message.type === "tabList") {
        setTabs(message.tabs)
        setActivePageId((current) => current ?? message.firstTabId ?? undefined)
      } else if (message !== undefined && "type" in message && message.type === "activeTabChange") setActivePageId(message.pageId)
      else if (message !== undefined && "type" in message && message.type === "tabClosed") {
        setTabs((current) => current.filter((tab) => tab.id !== message.pageId))
        setActivePageId((current) => current === message.pageId ? undefined : current)
      }
    }
    discovery.onerror = () => setConnection(CastConnectionState.DISCONNECTED)
    return () => {
      discovery.onmessage = null
      discovery.onerror = null
      discovery.close()
    }
  }, [castWebSocketUrl])

  useEffect(() => {
    if (activePageId === undefined) return
    setConnection(CastConnectionState.CONNECTING)
    setFrame(undefined)
    const socket = new WebSocket(pageCastUrl(castWebSocketUrl, activePageId))
    socketRef.current = socket
    socket.onopen = () => setConnection(CastConnectionState.WAITING_FRAME)
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return
      const message = parseCastMessage(event.data)
      if (message === undefined) return
      if ("data" in message && message.pageId === activePageId) {
        setFrame(`data:image/jpeg;base64,${message.data}`)
        setPageUrl(message.url)
        setConnection(CastConnectionState.STREAMING)
      } else if ("type" in message && message.type === "targetClosed") setConnection(CastConnectionState.DISCONNECTED)
    }
    socket.onclose = () => setConnection(CastConnectionState.DISCONNECTED)
    socket.onerror = () => setConnection(CastConnectionState.DISCONNECTED)
    return () => {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
      if (socketRef.current === socket) socketRef.current = undefined
    }
  }, [activePageId, castWebSocketUrl])

  function send(payload: unknown) {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(payload))
  }

  function key(event: ReactKeyboardEvent<HTMLElement>, type: "keyDown" | "keyUp") {
    if (!capture || activePageId === undefined) return
    if (event.key === "Escape") {
      event.preventDefault()
      onEscape()
      return
    }
    event.preventDefault()
    send({ event: { code: event.code, key: event.key, keyCode: event.keyCode, modifiers: modifiers(event), text: type === "keyDown" && event.key.length === 1 ? event.key : undefined, type }, pageId: activePageId, type: "keyEvent" })
  }

  function mouse(event: ReactMouseEvent<HTMLElement>, type: "mouseMoved" | "mousePressed" | "mouseReleased") {
    if (activePageId === undefined) return
    if (event.target !== imageRef.current) return
    const coordinates = scaledCoordinates(event, imageRef.current)
    if (coordinates === undefined) return
    send({ event: { ...coordinates, button: mouseButton(event.button, type), clickCount: event.detail, modifiers: modifiers(event), type }, pageId: activePageId, type: "mouseEvent" })
  }

  return (
    <section aria-label="Live browser cast" className={`cast-viewer${capture ? " cast-viewer--captured" : ""}`}>
      <header className="cast-viewer__chrome">
        <div className="cast-viewer__tabs" role="tablist" aria-label="Browser tabs">{tabs.map((tab) => <button aria-selected={tab.id === activePageId} key={tab.id} onClick={() => setActivePageId(tab.id)} role="tab" type="button">{tab.title || "Untitled tab"}</button>)}</div>
        <div className="cast-viewer__address"><MonitorUp aria-hidden="true" /><span>{pageUrl}</span><ConnectionLabel state={connection} /></div>
      </header>
      <button aria-label="Remote browser input surface" className="cast-viewer__frame" onKeyDown={(event) => key(event, "keyDown")} onKeyUp={(event) => key(event, "keyUp")} onMouseDown={(event) => mouse(event, "mousePressed")} onMouseMove={(event) => mouse(event, "mouseMoved")} onMouseUp={(event) => mouse(event, "mouseReleased")} ref={viewerRef} type="button">
        {frame === undefined || connection === CastConnectionState.DISCONNECTED ? <div aria-live="polite" className="cast-viewer__status"><CircleAlert aria-hidden="true" /><strong>{connection === CastConnectionState.DISCONNECTED ? "Cast disconnected" : "Waiting for a browser frame"}</strong><span>{connection === CastConnectionState.DISCONNECTED ? "Request a new live-view binding after confirming the session is still live." : "The public cast socket is connected without exposing the private worker."}</span></div> : <img alt={`Live browser frame for ${pageUrl}`} draggable={false} ref={imageRef} src={frame} />}
      </button>
    </section>
  )
}

function ConnectionLabel({ state }: Readonly<{ readonly state: CastConnectionState }>) {
  switch (state) {
    case CastConnectionState.STREAMING:
      return <span className="state-label state-label--success">Live</span>
    case CastConnectionState.CONNECTING:
      return <span className="state-label state-label--info">Connecting</span>
    case CastConnectionState.WAITING_FRAME:
      return <span className="state-label state-label--info">Waiting frame</span>
    case CastConnectionState.DISCONNECTED:
      return <span className="state-label state-label--error">Disconnected</span>
    default:
      return assertNever(state)
  }
}

function modifiers(event: Readonly<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

function mouseButton(button: number, type: "mouseMoved" | "mousePressed" | "mouseReleased"): "left" | "middle" | "none" | "right" {
  if (type === "mouseMoved") return "none"
  if (button === 0) return "left"
  if (button === 1) return "middle"
  return "right"
}

function scaledCoordinates(event: ReactMouseEvent<HTMLElement>, image: HTMLImageElement | null): Readonly<{ x: number; y: number }> | undefined {
  if (image === null || image.naturalWidth === 0 || image.naturalHeight === 0) return undefined
  const bounds = image.getBoundingClientRect()
  return {
    x: Math.round(Math.max(0, Math.min(image.naturalWidth, (event.clientX - bounds.left) * image.naturalWidth / bounds.width))),
    y: Math.round(Math.max(0, Math.min(image.naturalHeight, (event.clientY - bounds.top) * image.naturalHeight / bounds.height))),
  }
}
