// Editor model for one `permission` map (global config or a single agent's
// own permission), with lossless parse/serialize between the persisted shape
// and the model. Ported from OpenChamber's agentPermissionModel (the source-
// vs-resolved distinction is the important part: we only ever write what the
// user explicitly set; `GET /agent`'s resolved ruleset is a read hint, never
// written back).
//
// Persisted shapes (opencode v1.18.27 ConfigPermissionV1):
//   "edit": "allow"
//   "bash": { "*": "ask", "git commit*": "allow" }
//   "*": "deny"  (agent-level default)

export type PermissionAction = "allow" | "ask" | "deny"

export const PERMISSION_ACTIONS: PermissionAction[] = ["allow", "ask", "deny"]

export type PermissionConfig = Record<string, PermissionAction | Record<string, PermissionAction>>

export interface PermissionKeyState {
  /** Explicit action for the key's `*` pattern; null = not set (inherit). */
  action: PermissionAction | null
  /** Non-wildcard pattern rules, in stable order. */
  patterns: Array<{ pattern: string; action: PermissionAction }>
}

export interface PermissionModel {
  /** Explicit default (the `*` key); null = inherit. */
  global: PermissionAction | null
  keys: Record<string, PermissionKeyState>
}

export const isPermissionAction = (value: unknown): value is PermissionAction =>
  value === "allow" || value === "ask" || value === "deny"

export const emptyPermissionModel = (): PermissionModel => ({ global: null, keys: {} })

/** Parse the persisted PermissionConfig into the editor model, verbatim. */
export function parsePermissionConfig(config: unknown): PermissionModel {
  const model = emptyPermissionModel()
  if (config == null) return model
  if (typeof config === "string") {
    if (isPermissionAction(config)) model.global = config
    return model
  }
  if (typeof config !== "object" || Array.isArray(config)) return model

  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (key === "*") {
      if (isPermissionAction(value)) model.global = value
      continue
    }
    const state: PermissionKeyState = { action: null, patterns: [] }
    if (isPermissionAction(value)) {
      state.action = value
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [pattern, action] of Object.entries(value as Record<string, unknown>)) {
        if (!isPermissionAction(action)) continue
        if (pattern === "*") {
          state.action = action
        } else {
          state.patterns.push({ pattern, action })
        }
      }
    } else {
      continue
    }
    model.keys[key] = state
  }
  return model
}

/** Serialize the editor model back to the persisted shape (canonical form). */
export function serializePermissionModel(model: PermissionModel): PermissionConfig | null {
  const result: PermissionConfig = {}
  if (model.global !== null) {
    result["*"] = model.global
  }
  for (const [key, state] of Object.entries(model.keys)) {
    const patterns = state.patterns.filter((rule) => rule.pattern.trim().length > 0)
    if (state.action !== null && patterns.length === 0) {
      result[key] = state.action
    } else if (patterns.length > 0) {
      const nested: Record<string, PermissionAction> = {}
      if (state.action !== null) nested["*"] = state.action
      for (const rule of patterns) nested[rule.pattern] = rule.action
      result[key] = nested
    }
    // action === null && no patterns → key omitted entirely (inherit)
  }
  return Object.keys(result).length > 0 ? result : null
}

export function permissionModelsEqual(a: PermissionModel, b: PermissionModel): boolean {
  return JSON.stringify(serializePermissionModel(a)) === JSON.stringify(serializePermissionModel(b))
}

export function clonePermissionModel(model: PermissionModel): PermissionModel {
  return JSON.parse(JSON.stringify(model)) as PermissionModel
}

/** Keys that support per-pattern rules (everything path/command-scoped). */
export const PATTERN_CAPABLE_KEYS = new Set([
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "lsp",
  "skill",
])
