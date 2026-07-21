import {
  MANAGED_WORKER_RUNTIME,
} from "./image-policy.js"

const UPSTREAM_OPTIONAL_ENVIRONMENT_KEYS = [
  "DEFAULT_HEADERS",
  "DEFAULT_TIMEZONE",
  "ENABLE_CDP_LOGGING",
  "ENABLE_VERBOSE_LOGGING",
  "LANG",
  "LC_ALL",
  "LOG_CUSTOM_EMIT_EVENTS",
  "LOG_LEVEL",
  "PATH",
  "PROXY_INTERNAL_BYPASS",
  "PROXY_URL",
  "TZ",
] as const

export function buildUpstreamEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const upstream: NodeJS.ProcessEnv = {}
  for (const key of UPSTREAM_OPTIONAL_ENVIRONMENT_KEYS) {
    const value = environment[key]
    if (value !== undefined) {
      upstream[key] = value
    }
  }
  return {
    ...upstream,
    CDP_DOMAIN: `${MANAGED_WORKER_RUNTIME.UPSTREAM_HOST}:${MANAGED_WORKER_RUNTIME.PORT}`,
    CDP_REDIRECT_PORT: String(MANAGED_WORKER_RUNTIME.PORT),
    CHROME_ARGS: "--remote-debugging-address=127.0.0.1 --remote-debugging-port=0",
    CHROME_EXECUTABLE_PATH: "/usr/bin/chromium",
    CHROME_HEADLESS: "true",
    CHROME_USER_DATA_DIR: "/var/lib/steel/profile",
    DISABLE_CHROME_SANDBOX: "false",
    DISPLAY: ":10",
    DOMAIN: `${MANAGED_WORKER_RUNTIME.UPSTREAM_HOST}:${MANAGED_WORKER_RUNTIME.PORT}`,
    HOME: "/tmp/home",
    HOST: MANAGED_WORKER_RUNTIME.UPSTREAM_HOST,
    FILTER_CHROME_ARGS: "--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222",
    LOG_STORAGE_ENABLED: "false",
    NODE_ENV: "production",
    PORT: String(MANAGED_WORKER_RUNTIME.UPSTREAM_PORT),
    TMPDIR: "/tmp",
    USE_SSL: "false",
    XDG_RUNTIME_DIR: "/run/steel/runtime",
  }
}
