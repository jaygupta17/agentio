// Shared plumbing for the server-config page: the (server, directory) scope,
// query keys, and small presentational atoms every panel reuses.

import { createMemo, type Accessor } from "solid-js"
import { useServer, ServerConnection } from "@/context/server"
import { useLanguage } from "@/context/language"
import { sandboxIdFor } from "@/server-config/binding"
import type { Target } from "@/server-config/api"
import { classifyError, type UserError } from "@/e2b/errors"
import { createE2BProvider } from "@/e2b/cloud"
import { createJailedConfigFiles, SANDBOX_CONFIG_DIR, type JailedConfigFiles } from "@/server-config/files"

export interface ConfigScope {
  serverKey: Accessor<ServerConnection.Key>
  directory: Accessor<string>
  target: Accessor<Target>
  projects: Accessor<Array<{ worktree: string; expanded: boolean }>>
  sandboxId: Accessor<string | undefined>
  /** Config FILES are only reachable on E2B-backed servers. */
  fileCapable: Accessor<boolean>
  e2bKey: Accessor<string>
  /** Jailed file access for this server, when sandbox-backed. */
  files: () => JailedConfigFiles | undefined
}

export function useConfigScope(directory: Accessor<string>, e2bKey: Accessor<string>): ConfigScope {
  const server = useServer()
  const conn = createMemo(() => server.current)
  const serverKey = createMemo(() => (conn() ? ServerConnection.key(conn()!) : ("" as ServerConnection.Key)))
  const projects = createMemo(() => {
    const key = serverKey()
    if (!key) return []
    return server.projects.forServer(key).list()
  })
  const sandboxId = createMemo(() => sandboxIdFor(conn()?.http.url))

  return {
    serverKey,
    directory,
    target: createMemo<Target>(() => ({
      server: conn()?.http ?? { url: "" },
      ...(directory() ? { directory: directory() } : {}),
    })),
    projects,
    sandboxId,
    e2bKey,
    fileCapable: createMemo(() => !!sandboxId() && !!e2bKey()),
    files: () => {
      const id = sandboxId()
      const key = e2bKey()
      if (!id || !key) return undefined
      return createJailedConfigFiles(createE2BProvider(key), id, () => ({
        configDir: SANDBOX_CONFIG_DIR,
        worktreeDirs: projects().map((project) => project.worktree),
      }))
    },
  }
}

export function configQueryKey(serverKey: ServerConnection.Key, directory: string, section: string) {
  return ["server-config", serverKey, directory || "global", section] as const
}

export function useErrorText() {
  const language = useLanguage()
  return (err: unknown): string => {
    if (isUserError(err)) return language.t(err.key, err.params ?? {})
    const classified = classifyError(err)
    return language.t(classified.key, classified.params ?? {})
  }
}

export function isUserError(value: unknown): value is UserError {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as UserError).key === "string" &&
    /^(e2b\.error\.|settings\.e2b\.|dialog\.server\.add\.)/.test((value as UserError).key)
  )
}
