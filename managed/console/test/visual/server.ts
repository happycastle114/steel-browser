import { createServer, type ServerResponse } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, resolve } from "node:path"
import { WebSocketServer } from "ws"

const port = 4173
const buildRoot = resolve(process.cwd(), "build")
const indexPath = resolve(buildRoot, "index.html")
const contentTypes = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
] as const)

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`)
  const relative = url.pathname.startsWith("/ui/") ? url.pathname.slice(4) : ""
  const candidate = resolve(buildRoot, relative)
  const safe = candidate.startsWith(`${buildRoot}/`) && await isFile(candidate)
  await sendFile(response, safe ? candidate : indexPath)
})

const sockets = new WebSocketServer({ noServer: true })
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `ws://127.0.0.1:${port}`)
  if (!/^\/v1\/sessions\/[^/]+\/cast$/u.test(url.pathname)) {
    socket.destroy()
    return
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    if (url.searchParams.get("tabInfo") === "true") {
      webSocket.send(JSON.stringify({ firstTabId: "page-main", tabs: [{ favicon: null, id: "page-main", title: "Steel browser test", url: "https://example.com/" }], type: "tabList" }))
      return
    }
    webSocket.send(JSON.stringify({ data: jpegFrame, favicon: null, pageId: "page-main", title: "Steel browser test", url: "https://example.com/" }))
    webSocket.on("message", () => webSocket.close(1000, "input received"))
  })
})

server.listen(port, "127.0.0.1", () => process.stdout.write(`Steel console test server listening on ${port}\n`))

async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function sendFile(response: ServerResponse, path: string) {
  const bytes = await readFile(path)
  response.writeHead(200, { "cache-control": "no-store", "content-type": contentTypes.get(extname(path)) ?? "application/octet-stream" })
  response.end(bytes)
}

const jpegFrame = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k="
