// Shared E2B/serve provisioning logic (Cloud settings tab + first-run
// onboarding use this; no UI state lives here).
import { checkServerHealth } from "@/utils/server-health"
import { normalizeServerUrl, type ServerHttpCreds, ServerConnection } from "@/context/server"
import { buildAuthContent } from "./vault"
import type { UserError } from "./errors"
import type { CloudProvider, CloudSandbox } from "./cloud"

// Structural slice of the server context that connecting needs (testable seam).
export interface ConnectServer {
  saveSecret(url: string, creds: ServerHttpCreds): Promise<void>
  add(input: ServerConnection.Http): ServerConnection.Http | undefined
}

export const EXPECTED_OPENCODE_VERSION = "1.18.27"
export const DEFAULT_TEMPLATE = "agentio-opencode-v1"
export const SERVE_PORT = 4096

export function parseKeys(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const provider = trimmed.slice(0, eq).trim()
    const key = trimmed.slice(eq + 1).trim()
    if (provider && key) out[provider] = key
  }
  return out
}

/**
 * boot.sh accepts https origins plus (after the agentio template fix)
 * localhost and native-shell origins; anything else is dropped client-side
 * so a stray value can never make the sandbox boot exit 1.
 */
export function isAllowedCorsOrigin(origin: string): boolean {
  return (
    /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin) ||
    /^(tauri|capacitor):\/\/localhost$/.test(origin) ||
    /^http:\/\/tauri\.localhost$/.test(origin)
  )
}

export function bootEnvs(input: {
  devicePassword: string
  llmKeys: Record<string, string>
  corsOrigins?: string[]
}): { OPENCODE_SERVER_PASSWORD: string; OPENCODE_AUTH_CONTENT: string; AGENTIO_CORS_ORIGINS?: string } {
  const envs: {
    OPENCODE_SERVER_PASSWORD: string
    OPENCODE_AUTH_CONTENT: string
    AGENTIO_CORS_ORIGINS?: string
  } = {
    OPENCODE_SERVER_PASSWORD: input.devicePassword,
    OPENCODE_AUTH_CONTENT: buildAuthContent(input.llmKeys),
  }
  const origins = (input.corsOrigins ?? []).filter(isAllowedCorsOrigin)
  if (origins.length) envs.AGENTIO_CORS_ORIGINS = origins.join(",")
  return envs
}

export interface ConnectResult {
  ok: boolean
  version?: string
  error?: UserError
}

/**
 * Health-check a serve URL with credentials, persist secrets durably
 * (vault first), then register the server. The stored entry never carries a
 * password when a secret store is wired (context strips it).
 */
export async function connectServe(input: {
  server: ConnectServer
  url: string
  username?: string
  password?: string
  displayName?: string
  persistSecrets?: () => Promise<void>
  fetch?: typeof globalThis.fetch
  checkHealth?: (http: ServerConnection.HttpBase) => Promise<{ healthy: boolean; version?: string }>
}): Promise<ConnectResult> {
  const normalized = normalizeServerUrl(input.url)
  if (!normalized) return { ok: false, error: { key: "dialog.server.add.error" } }
  const conn: ServerConnection.Http = {
    type: "http",
    ...(input.displayName ? { displayName: input.displayName } : {}),
    http: { url: normalized, username: input.username, password: input.password },
  }
  const health = await (input.checkHealth ??
    ((http) => checkServerHealth(http, input.fetch ?? globalThis.fetch)))(conn.http)
  if (!health.healthy) return { ok: false, error: { key: "e2b.error.unreachable" } }
  if (input.persistSecrets) await input.persistSecrets()
  if (input.password) await input.server.saveSecret(normalized, { username: input.username, password: input.password })
  input.server.add(conn)
  return { ok: true, version: health.version }
}

export interface CreateAndBootResult {
  sandbox: CloudSandbox
  url: string
  version: string
}

/** create → startServe → getServeUrl → wait-for-health, with progress steps. */
export async function createAndBoot(input: {
  provider: CloudProvider
  template: string
  timeoutMs: number
  envs: Record<string, string>
  onProgress?: (step: "creating" | "starting" | "waiting") => void
  signal?: AbortSignal
}): Promise<CreateAndBootResult> {
  input.onProgress?.("creating")
  const created = await input.provider.createSandbox(input.template, input.timeoutMs)
  input.onProgress?.("starting")
  await input.provider.startServe(created.id, input.envs)
  const url = await input.provider.getServeUrl(created.id, SERVE_PORT)
  input.onProgress?.("waiting")
  const { waitForServeVersion } = await import("./cloud")
  const version = await waitForServeVersion(url, { signal: input.signal })
  return { sandbox: await input.provider.getSandbox(created.id), url, version }
}
