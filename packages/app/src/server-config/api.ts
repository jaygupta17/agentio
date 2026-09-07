// HTTP client for connected-server configuration. One seam, everything
// typed; components never touch the raw SDK.
//
// Scoped-write reality on v1.18.27 (verified live against the pinned tag —
// see agentio-notes/decisions.md):
//   - instance PATCH /config writes <dir>/config.json, which the config
//     loader NEVER reads → project-scope writes go through the files seam
//     (E2B) on <worktree>/.opencode/opencode.json, never through this API.
//   - global PATCH /global/config works (writes ~/.config/opencode/*,
//     auto-disposes instances on change) and merge-patches, so it can only
//     add/overwrite keys, never delete them. Deletion = file rewrite (E2B).

import { createSdkForServer } from "@/utils/server"
import type { ServerConnection } from "@/context/server"
import type { AgentInfo, CommandInfo, McpConfig, McpStatusMap, ServerConfigDocument, SkillInfo } from "./types"

export interface Target {
  server: ServerConnection.HttpBase
  directory?: string
  fetch?: typeof globalThis.fetch
}

function client(target: Target) {
  return createSdkForServer({
    server: target.server,
    fetch: target.fetch ?? globalThis.fetch,
    throwOnError: true,
    ...(target.directory ? { directory: target.directory } : {}),
  })
}

/**
 * throwOnError clients resolve to { data } unless a typed error union remains
 * in the generated types; centralizing the unwrap here keeps the casts in
 * one place. Runtime contract: throwOnError guarantees data on resolve.
 */
async function data<T>(promise: Promise<unknown>): Promise<T> {
  return (await promise as { data: T }).data
}

export function getMergedConfig(target: Target) {
  return data<ServerConfigDocument>(client(target).config.get())
}

export function getGlobalConfig(target: Target) {
  return data<ServerConfigDocument>(client(target).global.config.get())
}

/**
 * Deep-merge patch into the global config file (comment-preserving when the
 * target is .jsonc). Setting null/undefined does NOT delete keys (remeda
 * mergeDeep + JSON drops undefined) — use disable shapes or rewrite files.
 */
export function patchGlobalConfig(target: Target, patch: ServerConfigDocument) {
  return data<ServerConfigDocument>(client(target).global.config.update({ config: patch as never }))
}

export function listAgents(target: Target) {
  return data<AgentInfo[]>(client(target).app.agents())
}

export function listSkills(target: Target) {
  return data<SkillInfo[]>(client(target).app.skills())
}

export function listCommands(target: Target) {
  return data<CommandInfo[]>(client(target).command.list())
}

export function mcpStatus(target: Target) {
  return data<McpStatusMap>(client(target).mcp.status())
}

/** Ephemeral: lives in the running instance only; not persisted anywhere. */
export function mcpAddEphemeral(target: Target, name: string, config: McpConfig) {
  return data<McpStatusMap>(client(target).mcp.add({ name, config }))
}

export function mcpConnect(target: Target, name: string) {
  return client(target).mcp.connect({ name })
}

export function mcpDisconnect(target: Target, name: string) {
  return client(target).mcp.disconnect({ name })
}

export function setProviderKey(target: Target, providerID: string, key: string) {
  return client(target).auth.set({ providerID, auth: { type: "api", key } })
}

export function removeProviderKey(target: Target, providerID: string) {
  return client(target).auth.remove({ providerID })
}

/** Force the instance to reload config files (after external file writes). */
export function disposeInstance(target: Target) {
  return client(target).instance.dispose()
}

export function disposeAll(target: Target) {
  return client(target).global.dispose()
}
