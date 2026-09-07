// Which connected servers are backed by an E2B sandbox we hold files access
// to. Vault-backed (server creds carry sandboxId), mirrored reactively here
// so config UI can distinguish full-capability from read-only servers
// without awaiting IndexedDB at every read site.

import { createSignal } from "solid-js"
import type { ServerHttpCreds } from "@/context/server"

const [bindings, setBindings] = createSignal<Record<string, string>>({})

export function initServerBindings(secrets: Record<string, ServerHttpCreds>) {
  const next: Record<string, string> = {}
  for (const [url, creds] of Object.entries(secrets)) {
    if (creds.sandboxId) next[url] = creds.sandboxId
  }
  setBindings(next)
}

export function setServerBinding(url: string, sandboxId: string | undefined) {
  setBindings((prev) => {
    const next = { ...prev }
    if (sandboxId) next[url] = sandboxId
    else delete next[url]
    return next
  })
}

/** URL of a connected serve → its sandbox id, or undefined for remote-only. */
export function sandboxIdFor(url: string | undefined): string | undefined {
  if (!url) return
  return bindings()[url]
}
