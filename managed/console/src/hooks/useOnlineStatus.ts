import { useSyncExternalStore } from "react"

const subscribe = (listener: () => void): (() => void) => {
  globalThis.addEventListener("online", listener)
  globalThis.addEventListener("offline", listener)
  return () => {
    globalThis.removeEventListener("online", listener)
    globalThis.removeEventListener("offline", listener)
  }
}

const current = (): boolean => globalThis.navigator.onLine
const server = (): boolean => true

export const useOnlineStatus = (): boolean => useSyncExternalStore(subscribe, current, server)
