import { Moon, Monitor, Sun } from "lucide-react"
import { useEffect, useState } from "react"

import { assertNever } from "../domain/vocabulary.js"

const ThemeMode = { DARK: "dark", LIGHT: "light", SYSTEM: "system" } as const
type ThemeMode = (typeof ThemeMode)[keyof typeof ThemeMode]

function nextTheme(theme: ThemeMode): ThemeMode {
  switch (theme) {
    case ThemeMode.SYSTEM:
      return ThemeMode.LIGHT
    case ThemeMode.LIGHT:
      return ThemeMode.DARK
    case ThemeMode.DARK:
      return ThemeMode.SYSTEM
    default:
      return assertNever(theme)
  }
}

function themePresentation(theme: ThemeMode) {
  switch (theme) {
    case ThemeMode.SYSTEM:
      return { icon: Monitor, label: "Use system theme" }
    case ThemeMode.LIGHT:
      return { icon: Sun, label: "Use light theme" }
    case ThemeMode.DARK:
      return { icon: Moon, label: "Use dark theme" }
    default:
      return assertNever(theme)
  }
}

export function ThemeSelector() {
  const [theme, setTheme] = useState<ThemeMode>(ThemeMode.SYSTEM)
  const current = themePresentation(theme)
  const Icon = current.icon

  useEffect(() => {
    if (theme === ThemeMode.SYSTEM) {
      document.documentElement.removeAttribute("data-theme")
      return
    }
    document.documentElement.dataset["theme"] = theme
  }, [theme])

  return (
    <button className="theme-selector" onClick={() => setTheme(nextTheme(theme))} title={`${current.label}; activate to change`} type="button">
      <Icon aria-hidden="true" />
      <span className="sr-only">{current.label}; activate to change</span>
    </button>
  )
}
