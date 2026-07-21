import type { LucideIcon } from "lucide-react"
import { useId } from "react"

import { ActionButton, ButtonVariant } from "./ActionButton.js"

type EmptyStateProps = Readonly<{
  readonly actionLabel?: string
  readonly icon: LucideIcon
  readonly message: string
  readonly onAction?: () => void
  readonly title: string
}>

export function EmptyState({ actionLabel, icon: Icon, message, onAction, title }: EmptyStateProps) {
  const titleId = useId()
  return (
    <section className="empty-state" aria-labelledby={titleId}>
      <Icon aria-hidden="true" className="empty-state__icon" />
      <div className="empty-state__copy">
        <h2 id={titleId}>{title}</h2>
        <p>{message}</p>
      </div>
      {actionLabel && onAction ? <ActionButton label={actionLabel} onClick={onAction} variant={ButtonVariant.SECONDARY} /> : null}
    </section>
  )
}
