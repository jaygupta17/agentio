// Jailed sandbox file access for server configuration (E2B only).
//
// opencode serve has NO file-write HTTP endpoint in v1.18.27 (verified:
// /file is GET-only), so creating agents/skills/commands as .md files and
// deleting config keys requires writing the sandbox FS directly. To keep
// that safe, every path goes through resolveConfigPath() first: only the
// exact locations opencode itself loads are writable, with a filename
// allowlist. Anything else throws before a network call.

import { applyEdits, modify, parse } from "jsonc-parser"
import type { CloudProvider } from "@/e2b/cloud"

export class ConfigPathError extends Error {}

export interface ConfigPathRoots {
  /** Sandbox global config dir, e.g. /home/user/.config/opencode */
  configDir: string
  /** Project worktrees served by this instance (absolute sandbox paths) */
  worktreeDirs: string[]
}

export type ConfigPathKind =
  | "global-config-file"
  | "global-entity"
  | "project-config-file"
  | "project-dot-opencode"

const GLOBAL_CONFIG_FILES = new Set(["opencode.json", "opencode.jsonc", "config.json", "AGENTS.md"])
const GLOBAL_ENTITY_DIRS = ["agent", "agents", "mode", "modes", "command", "commands", "skill", "skills", "plugin", "plugins"]
const FILE_EXT = /\.(md|json|jsonc|ts|js)$/i

function normalize(absolutePath: string): string {
  const parts: string[] = []
  for (const seg of absolutePath.split("/")) {
    if (!seg || seg === ".") continue
    if (seg === "..") {
      parts.pop()
      continue
    }
    parts.push(seg)
  }
  return `/${parts.join("/")}`
}

function underRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

/**
 * Validate an absolute sandbox path against the config jail. Returns the
 * normalized path plus which allowed location it is. Throws on anything
 * else (traversal, other roots, unexpected extensions).
 */
export function resolveConfigPath(absolutePath: string, roots: ConfigPathRoots): { path: string; kind: ConfigPathKind } {
  if (!absolutePath.startsWith("/")) throw new ConfigPathError(`absolute path required: ${absolutePath}`)
  const path = normalize(absolutePath)
  if (!FILE_EXT.test(path)) throw new ConfigPathError(`file type not writable: ${path}`)
  const file = path.slice(path.lastIndexOf("/") + 1)

  const configDir = normalize(roots.configDir)
  if (underRoot(path, configDir)) {
    const rest = path.slice(configDir.length + 1)
    const top = rest.split("/")[0]
    if (rest.split("/").length === 1 && GLOBAL_CONFIG_FILES.has(file)) return { path, kind: "global-config-file" }
    if (rest.split("/").length === 1 && top === "node_modules") throw new ConfigPathError(`not writable: ${path}`)
    if (GLOBAL_ENTITY_DIRS.includes(top)) return { path, kind: "global-entity" }
    throw new ConfigPathError(`outside allowed config locations: ${path}`)
  }

  for (const worktree of roots.worktreeDirs) {
    const root = normalize(worktree)
    if (!underRoot(path, root)) continue
    const rest = path.slice(root.length + 1)
    const segments = rest.split("/")
    if (segments[0] === ".opencode") {
      // .opencode/{agent,s...,plugin}/** or the .opencode/opencode.json(c) itself
      const inner = segments.slice(1)
      if (!inner.length) throw new ConfigPathError(`directory not writable: ${path}`)
      if (inner.length === 1 && GLOBAL_CONFIG_FILES.has(file)) return { path, kind: "project-config-file" }
      if (GLOBAL_ENTITY_DIRS.includes(inner[0])) return { path, kind: "project-dot-opencode" }
      throw new ConfigPathError(`outside allowed project locations: ${path}`)
    }
    if (segments.length === 1 && (file === "AGENTS.md" || GLOBAL_CONFIG_FILES.has(file))) {
      return { path, kind: "project-config-file" }
    }
    throw new ConfigPathError(`outside allowed project locations: ${path}`)
  }

  throw new ConfigPathError(`outside configured roots: ${path}`)
}

/**
 * Directory variant for listing: anywhere under the config dir (excluding
 * node_modules) or a worktree's .opencode dir is listable.
 */
export function resolveConfigDir(absoluteDir: string, roots: ConfigPathRoots): string {
  if (!absoluteDir.startsWith("/")) throw new ConfigPathError(`absolute dir required: ${absoluteDir}`)
  const dir = normalize(absoluteDir)
  const configDir = normalize(roots.configDir)
  if (underRoot(dir, configDir)) {
    if (dir === `${configDir}/node_modules` || dir.startsWith(`${configDir}/node_modules/`)) {
      throw new ConfigPathError(`not listable: ${dir}`)
    }
    return dir
  }
  for (const worktree of roots.worktreeDirs) {
    const root = normalize(worktree)
    if (underRoot(dir, root)) return dir
  }
  throw new ConfigPathError(`outside configured roots: ${dir}`)
}

export interface JailedConfigFiles {
  read(absolutePath: string): Promise<string>
  write(absolutePath: string, content: string): Promise<void>
  remove(absolutePath: string): Promise<void>
  exists(absolutePath: string): Promise<boolean>
  list(absoluteDir: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>
  roots(): ConfigPathRoots
}

export function createJailedConfigFiles(
  provider: Pick<CloudProvider, "readFile" | "writeFile" | "removeFile" | "existsFile" | "listDir">,
  sandboxId: string,
  input: () => ConfigPathRoots,
): JailedConfigFiles {
  return {
    async read(path) {
      resolveConfigPath(path, input())
      return provider.readFile(sandboxId, path)
    },
    async write(path, content) {
      resolveConfigPath(path, input())
      await provider.writeFile(sandboxId, path, content)
    },
    async remove(path) {
      resolveConfigPath(path, input())
      await provider.removeFile(sandboxId, path)
    },
    async exists(path) {
      resolveConfigPath(path, input())
      return provider.existsFile(sandboxId, path)
    },
    async list(dir) {
      resolveConfigDir(dir, input())
      return provider.listDir(sandboxId, dir)
    },
    roots: input,
  }
}

/** Read a path out of a JSONC document (for surgical PATCH-style edits). */
export function getJsoncPath<T>(text: string, path: Array<string | number>): T | undefined {
  return reducePath(parse(text, [], { allowTrailingComma: true }), path) as T | undefined
}

function reducePath(value: unknown, path: Array<string | number>): unknown {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

/**
 * Set or delete (value === undefined) one path inside a JSONC document,
 * preserving comments/formatting elsewhere. Mirrors opencode's own
 * updateGlobal patchJsonc approach (jsonc-parser modify + applyEdits).
 */
export function editJsoncPath(
  text: string,
  path: Array<string | number>,
  value: unknown,
): string {
  const edits = modify(text, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  })
  return applyEdits(text, edits)
}
