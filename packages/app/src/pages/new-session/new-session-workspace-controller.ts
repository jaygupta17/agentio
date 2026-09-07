import { createMemo, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { readSync } from "@/utils/safe-read"

const workspaceBarEnabled = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"

export function resolveNewSessionWorktree(input: {
  enabled: boolean
  selected?: string
  directory: string
  projectWorktree?: string
}) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  if (input.projectWorktree && input.directory !== input.projectWorktree) return input.directory
  return "main"
}

export function normalizeNewSessionWorktree(value: string, directory: string, projectWorktree?: string) {
  if (value === "main" && projectWorktree !== directory) return projectWorktree
  return value
}

export function resolveNewSessionBranch(input: {
  worktree: string
  local?: string
  worktreeBranch: (worktree: string) => string | undefined
}) {
  if (input.worktree === "main" || input.worktree === "create") return input.local
  return input.worktreeBranch(input.worktree) ?? input.local
}

export function createNewSessionWorkspaceController() {
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const [worktree, setWorktree] = createSignal<string>()
  // agentio fork: every accessor below is transiently undefined mid-bootstrap
  // (see utils/safe-read). Empty fallbacks keep the session mount alive;
  // reactivity refills them once bootstrap settles.
  const visible = createMemo(() => workspaceBarEnabled && readSync(sync)?.project?.vcs === "git")
  const value = createMemo(() =>
    resolveNewSessionWorktree({
      enabled: visible(),
      selected: worktree(),
      directory: readSync(sdk)?.directory ?? "",
      projectWorktree: readSync(sync)?.project?.worktree,
    }),
  )
  const projectRoot = createMemo(() => readSync(sync)?.project?.worktree ?? readSync(sdk)?.directory ?? "")
  const localBranch = createMemo(() => {
    const root = projectRoot()
    if (!root) return undefined
    return readSync(serverSync)?.child(root)[0]?.vcs?.branch
  })
  const branch = createMemo(() =>
    resolveNewSessionBranch({
      worktree: value(),
      local: localBranch(),
      worktreeBranch: (worktree) => readSync(serverSync)?.child(worktree)[0]?.vcs?.branch,
    }),
  )

  return {
    selection: {
      value,
      reset: () => setWorktree(),
      set: (worktree: string) =>
        setWorktree(normalizeNewSessionWorktree(worktree, readSync(sdk)?.directory ?? "", readSync(sync)?.project?.worktree)),
    },
    project: {
      root: projectRoot,
      workspaces: () => readSync(sync)?.project?.sandboxes ?? [],
      git: () => readSync(sync)?.project?.vcs === "git",
    },
    bar: {
      visible,
      branch,
    },
  }
}

export type NewSessionWorkspaceController = ReturnType<typeof createNewSessionWorkspaceController>
