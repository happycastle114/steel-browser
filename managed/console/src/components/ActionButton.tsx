import { LoaderCircle, type LucideIcon } from "lucide-react"
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"

import { ConsoleState } from "../domain/vocabulary.js"

const ButtonVariant = {
  DESTRUCTIVE: "destructive",
  PRIMARY: "primary",
  QUIET: "quiet",
  SECONDARY: "secondary",
} as const
type ButtonVariant = (typeof ButtonVariant)[keyof typeof ButtonVariant]

type ActionButtonProps = Readonly<{
  readonly children?: ReactNode
  readonly icon?: LucideIcon
  readonly label: string
  readonly loadingLabel?: string
  readonly state?: ConsoleState
  readonly variant: ButtonVariant
}> & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton({
  children,
  disabled = false,
  icon: Icon,
  label,
  loadingLabel,
  state = ConsoleState.READY,
  type = "button",
  variant,
  ...buttonProps
}: ActionButtonProps, ref) {
  const isLoading = state === ConsoleState.LOADING
  const visibleLabel = isLoading ? (loadingLabel ?? label) : label

  return (
    <button
      {...buttonProps}
      aria-busy={isLoading}
      className={`action-button action-button--${variant}`}
      disabled={disabled || isLoading}
      ref={ref}
      type={type}
    >
      {isLoading ? <LoaderCircle aria-hidden="true" className="action-button__spinner" /> : Icon ? <Icon aria-hidden="true" /> : null}
      <span>{visibleLabel}</span>
      {children}
    </button>
  )
})

export { ButtonVariant }
