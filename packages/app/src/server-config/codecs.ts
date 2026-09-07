// Codecs matching what the pinned v1.18.27 server actually parses
// (opencode config/markdown.ts + config/{agent,command}.ts + skill/index.ts):
//   agent .md    → frontmatter = agent config object, body = system prompt
//   command .md  → frontmatter = command info, body = prompt template
//   SKILL.md     → frontmatter {name, description?}, body = instructions
// Names come from file paths (configEntryNameFromPath), not frontmatter —
// except skills, where `name` in frontmatter IS the identity.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { PermissionConfig } from "./permissions"

export interface FrontmatterDocument {
  data: Record<string, unknown>
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/

export function parseFrontmatterMarkdown(text: string): FrontmatterDocument {
  const match = text.match(FRONTMATTER_RE)
  if (!match) return { data: {}, body: text.trim() }
  let data: unknown = {}
  try {
    data = parseYaml(match[1]) ?? {}
  } catch {
    data = {}
  }
  return {
    data: typeof data === "object" && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
    body: match[2].trim(),
  }
}

export function buildFrontmatterMarkdown(data: Record<string, unknown>, body: string): string {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (!keys.length) return `${body}\n`
  const ordered: Record<string, unknown> = {}
  for (const k of keys) ordered[k] = data[k]
  const frontmatter = stringifyYaml(ordered, { lineWidth: 0 }).trimEnd()
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`
}

export interface AgentFileConfig {
  description?: string
  mode?: "subagent" | "primary" | "all"
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  permission?: PermissionConfig | null
  hidden?: boolean
  steps?: number
  color?: string
  [extra: string]: unknown
}

const AGENT_META_KEYS = new Set(["name", "prompt"])

export function parseAgentMarkdown(text: string): AgentFileConfig & { prompt: string } {
  const { data, body } = parseFrontmatterMarkdown(text)
  const config: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (AGENT_META_KEYS.has(key)) continue
    config[key] = value
  }
  if (typeof config.permission !== "object" || config.permission === null) delete config.permission
  // Mirrors server merge ({...md.data, prompt: body}): the body always wins.
  return { ...(config as AgentFileConfig), prompt: body }
}

export function buildAgentMarkdown(config: AgentFileConfig, prompt: string): string {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (AGENT_META_KEYS.has(key) || value === undefined || value === null) continue
    data[key] = value
  }
  return buildFrontmatterMarkdown(data, prompt)
}

export interface SkillDocument {
  name: string
  description?: string
  instructions: string
}

export function parseSkillMarkdown(text: string): SkillDocument | undefined {
  const { data, body } = parseFrontmatterMarkdown(text)
  if (typeof data.name !== "string" || !data.name.trim()) return undefined
  return {
    name: data.name.trim(),
    ...(typeof data.description === "string" ? { description: data.description } : {}),
    instructions: body,
  }
}

export function buildSkillMarkdown(doc: SkillDocument): string {
  const data: Record<string, unknown> = { name: doc.name }
  if (doc.description) data.description = doc.description
  return buildFrontmatterMarkdown(data, doc.instructions)
}

export interface CommandFileConfig {
  description?: string
  agent?: string
  model?: string
  variant?: string
  subtask?: boolean
  [extra: string]: unknown
}

export function parseCommandMarkdown(text: string): { config: CommandFileConfig; template: string } {
  const { data, body } = parseFrontmatterMarkdown(text)
  const config: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === "name" || key === "template") continue
    config[key] = value
  }
  const template = typeof data.template === "string" ? data.template : body
  return { config: config as CommandFileConfig, template }
}

export function buildCommandMarkdown(config: CommandFileConfig, template: string): string {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key === "name" || value === undefined) continue
    data[key] = value
  }
  return buildFrontmatterMarkdown(data, template)
}
