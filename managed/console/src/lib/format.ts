import type { IsoTime } from "../api/schema-primitives.js"

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  second: "2-digit",
  timeZoneName: "short",
  year: "numeric",
})

const compactNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" })

export const formatTimestamp = (value: IsoTime): string => dateFormatter.format(new Date(value))

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`
  const seconds = Math.floor(milliseconds / 1_000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}

export const formatBytes = (bytes: number): string => `${compactNumber.format(bytes)}B`

export function durationSince(value: IsoTime): string {
  return formatDuration(Math.max(0, Date.now() - Date.parse(value)))
}

export const shortIdentifier = (value: string): string => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
