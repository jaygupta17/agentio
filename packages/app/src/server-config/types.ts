// Config-management domain types. Field shapes verified against the pinned
// v1.18.27 server (packages/core/src/v1/config/*) and live GET /agent,
// GET /skill, GET /mcp responses — not invented.

import type { PermissionConfig } from "./permissions"

export interface AgentConfig {
  description?: string
  mode?: "subagent" | "primary" | "all"
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  options?: Record<string, unknown>
  permission?: PermissionConfig
  hidden?: boolean
  steps?: number
  color?: string
}

/** One entry of GET /agent (server-resolved; source config may be sparser). */
export interface AgentInfo extends AgentConfig {
  name: string
  native?: boolean
}

export interface SkillInfo {
  name: string
  description?: string
  location: string
  content: string
}

export interface CommandInfo {
  name: string
  description?: string
  source?: string
  hints?: string[]
  template?: string
}

export type McpConfig =
  | {
      type: "local"
      command: string[]
      cwd?: string
      environment?: Record<string, string>
      enabled?: boolean
      timeout?: number
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      enabled?: boolean
      timeout?: number
      oauth?: Record<string, unknown> | false
    }

export interface McpStatusEntry {
  name?: string
  status: string
  error?: string
  [extra: string]: unknown
}

export type McpStatusMap = Record<string, McpStatusEntry>

/** The subset of opencode.json the config UI reads/writes. */
export interface ServerConfigDocument {
  $schema?: string
  model?: string
  default_agent?: string
  subagent_depth?: number
  autoshare?: boolean
  share?: string
  permission?: PermissionConfig
  agent?: Record<string, AgentConfig>
  mcp?: Record<string, McpConfig | { enabled: boolean }>
  command?: Record<string, { description?: string; template?: string; agent?: string; model?: string; subtask?: boolean }>
  skills?: { paths?: string[]; urls?: string[] }
  plugin?: Array<string | [string, Record<string, unknown>]>
  [extra: string]: unknown
}

/** A server connection that also knows its sandbox binding (E2B only). */
export interface ServerBinding {
  sandboxId?: string
}
