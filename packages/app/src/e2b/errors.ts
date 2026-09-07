// User-safe error mapping for the E2B/serve flows (ported from the agentio
// web PWA's engine.ts). SDK methods resolve tagged unions instead of
// throwing, so raw messages can embed baseUrls and credentials — classify
// into an i18n key and redact anything secret-shaped before it reaches the
// UI. Call sites render language.t(err.key, err.params).

export type ErrorKey =
  | "e2b.error.auth"
  | "e2b.error.notFound"
  | "e2b.error.busy"
  | "e2b.error.unreachable"
  | "e2b.error.server"
  | "e2b.error.raw"
  | "settings.e2b.passwordRequired"
  | "settings.e2b.keyRequired"
  | "dialog.server.add.error"

export interface UserError {
  key: ErrorKey
  params?: Record<string, string | number>
}

function readField(err: unknown, field: "message" | "_tag"): string {
  if (err && typeof err === "object") {
    const v = (err as Record<string, unknown>)[field]
    if (typeof v === "string") return v
    if (typeof v === "number") return String(v)
  }
  return ""
}

export function classifyError(err: unknown): UserError {
  if (err === undefined || err === null) return { key: "e2b.error.raw", params: { message: "Something went wrong." } }
  const raw = typeof err === "string" ? err : readField(err, "message") || (err instanceof Error ? err.message : "")
  if (!raw.trim()) return { key: "e2b.error.raw", params: { message: "Something went wrong." } }
  const tag = readField(err, "_tag") || (err instanceof Error ? err.name : "")
  const hay = `${tag} ${raw}`
  if (/UnauthorizedError|status 401|\b401\b/.test(hay)) return { key: "e2b.error.auth" }
  if (/SessionNotFoundError|\b404\b/.test(hay)) return { key: "e2b.error.notFound" }
  if (/ConflictError|\b409\b/.test(hay)) return { key: "e2b.error.busy" }
  if (/Failed to fetch|Load failed|NetworkError|fetch failed|ERR_NETWORK|ECONNREFUSED/i.test(hay))
    return { key: "e2b.error.unreachable" }
  if (/\b50\d\b/.test(hay)) return { key: "e2b.error.server" }
  return { key: "e2b.error.raw", params: { message: redactSecrets(raw).split("\n")[0].slice(0, 200) } }
}

export function redactSecrets(s: string): string {
  return s
    .replace(/e2b_[A-Za-z0-9_-]+/g, "e2b_***")
    .replace(/Basic [A-Za-z0-9+/=]+/g, "Basic ***")
    .replace(/Bearer [A-Za-z0-9._~-]+/g, "Bearer ***")
    .replace(/(auth_token=)[^&\s]+/g, "$1***")
    .replace(/(OPENCODE_AUTH_CONTENT|"key"\s*:\s*")[^"\n]+/g, (_m, head, quote) => (quote ? `${quote}***` : head + "***"))
}
