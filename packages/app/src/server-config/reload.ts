// Queue for "the server must reload" after external (E2B file) writes.
// Config-PATCH flows reload themselves (the server disposes instances after
// a successful change), so only file writes land here — mirroring
// OpenChamber's deferred-restart badge so we never tear down instances
// mid-edit while a user is batching changes.

import { createSignal } from "solid-js"
import { disposeAll, disposeInstance, type Target } from "./api"

const [instanceDirs, setInstanceDirs] = createSignal(new Set<string>())
const [needsGlobal, setNeedsGlobal] = createSignal(false)

export function markInstanceReload(directory: string) {
  setInstanceDirs((prev) => new Set(prev).add(directory))
}

export function markGlobalReload() {
  setNeedsGlobal(true)
}

export function pendingReloadCount() {
  return instanceDirs().size + (needsGlobal() ? 1 : 0)
}

export function clearPendingReloads() {
  setInstanceDirs(() => new Set<string>())
  setNeedsGlobal(false)
}

/** Dispose the queued instances (config reloads lazily on next request). */
export async function applyPendingReloads(targets: () => Target[]) {
  const global = needsGlobal()
  const dirs = [...instanceDirs()]
  if (global) {
    for (const target of targets()) {
      await disposeAll(target)
      break
    }
  } else {
    for (const directory of dirs) {
      const target = targets().find((t) => t.directory === directory) ?? targets()[0]
      if (target) await disposeInstance({ ...target, directory })
    }
  }
  clearPendingReloads()
}
