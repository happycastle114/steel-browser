import { AlertCircle, CircleCheck, Info, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"

import { NoticeTone, assertNever } from "../domain/vocabulary.js"

function noticeIcon(tone: NoticeTone) {
  switch (tone) {
    case NoticeTone.ERROR:
      return AlertCircle
    case NoticeTone.INFO:
      return Info
    case NoticeTone.SUCCESS:
      return CircleCheck
    case NoticeTone.WARNING:
      return TriangleAlert
    default:
      return assertNever(tone)
  }
}

export function InlineNotice({ actions, message, title, tone }: Readonly<{ readonly actions?: ReactNode; readonly message: string; readonly title: string; readonly tone: NoticeTone }>) {
  const Icon = noticeIcon(tone)
  return (
    <section className={`inline-notice inline-notice--${tone}`} aria-live={tone === NoticeTone.ERROR ? "assertive" : "polite"}>
      <Icon aria-hidden="true" />
      <div className="inline-notice__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {actions}
    </section>
  )
}
