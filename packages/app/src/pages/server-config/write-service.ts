// The single write path for global-scoped config changes.
//
// Server behavior (verified, decisions.md): PATCH /global/config merge-patches
// the global config file. For a plain .json file the merge is deep
// (remeda); for .jsonc the server rewrites per-leaf — so we always send a
// FULL computed section (read merged, edit, send whole key) which is correct
// under both semantics. Deleting keys is not expressible through a merge
// patch at all; on E2B servers we instead edit the global file directly and
// mark the instance reload queue.

import { editJsoncPath, type JailedConfigFiles } from "@/server-config/files"
import { getGlobalConfig, patchGlobalConfig, type Target } from "@/server-config/api"
import { markGlobalReload, markInstanceReload } from "@/server-config/reload"
import type { ServerConfigDocument } from "@/server-config/types"

export interface WriteService {
  /** read source global document (merged view as the server exposes it) */
  read(): Promise<ServerConfigDocument>
  /** Replace one top-level section with the given value (whole-section
   * replacement; callers build the complete section). */
  setSection(section: string, value: unknown): Promise<void>
  /** remove one nested entry (needs file access; throws otherwise) */
  removePath?(path: Array<string | number>): Promise<void>
  fileCapable: boolean
}

export function createGlobalWriteService(input: {
  target: Target
  files?: () => JailedConfigFiles | undefined
  sandboxConfigDir: string
}): WriteService {
  const files = input.files?.()

  // Mirrors the server's globalConfigFile() candidate order.
  async function resolveGlobalFile(): Promise<string> {
    for (const candidate of ["opencode.jsonc", "opencode.json", "config.json"]) {
      const path = `${input.sandboxConfigDir}/${candidate}`
      if (await files!.exists(path)) return path
    }
    return `${input.sandboxConfigDir}/opencode.json`
  }

  async function fileWrite(mutate: (text: string) => string): Promise<void> {
    if (!files) throw new Error("file access unavailable")
    const path = await resolveGlobalFile()
    let text: string
    try {
      text = await files.read(path)
    } catch {
      text = `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
    }
    await files.write(path, mutate(text) + "\n")
    markGlobalReload()
  }

  return {
    fileCapable: !!files,
    async read() {
      return getGlobalConfig(input.target)
    },
    async setSection(section: string, value: unknown) {
      if (files) {
        await fileWrite((text) => editJsoncPath(text, [section], value))
        return
      }
      await patchGlobalConfig(input.target, { [section]: value } as ServerConfigDocument)
    },
    async removePath(path) {
      if (!files) throw new Error("deleting config entries requires an E2B-connected server")
      await fileWrite((text) => editJsoncPath(text, path, undefined))
    },
  }
}

export type { JailedConfigFiles }

/**
 * Project-scoped writes: only via E2B files into `<worktree>/.opencode/`.
 * (Instance PATCH /config is the dead-write trap documented above.)
 */
export function createProjectWriteService(input: { files: () => JailedConfigFiles; worktree: string }) {
  const projectConfigPath = () => `${input.worktree}/.opencode/opencode.json`

  async function readText(): Promise<string> {
    try {
      return await input.files().read(projectConfigPath())
    } catch {
      return `{\n  "$schema": "https://opencode.ai/config.json"\n}\n`
    }
  }

  async function mutate(mutate: (text: string) => string) {
    const text = await readText()
    await input.files().write(projectConfigPath(), mutate(text) + "\n")
    markInstanceReload(input.worktree)
  }

  return {
    fileCapable: true as const,
    async read(): Promise<ServerConfigDocument> {
      try {
        return JSON.parse(await readText()) as ServerConfigDocument
      } catch (err) {
        if (err instanceof SyntaxError) throw new Error(`project config ${projectConfigPath()} is not valid JSON`)
        throw err
      }
    },
    setSection(section: string, value: unknown) {
      return mutate((text) => editJsoncPath(text, [section], value))
    },
    removePath(path: Array<string | number>) {
      return mutate((text) => editJsoncPath(text, path, undefined))
    },
    projectConfigPath,
  }
}

/** Where entity files (agents/skills/commands) live for a given scope. */
export function entityRoot(scope: { configDir: string; worktree?: string }) {
  return scope.worktree ? `${scope.worktree}/.opencode` : scope.configDir
}
