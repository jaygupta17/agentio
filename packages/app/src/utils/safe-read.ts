// agentio fork: server-backed accessors (serverSync/useSync/useSDK) are
// transiently undefined mid-bootstrap — adding a project fires a
// bootstrap setStore cascade that re-runs session-path memos before the
// dir-sync ctx resolves. Upstream always has a warm local sidecar server,
// so it dereferences unconditionally and crashes cold (notably the
// add-project → new-session journey). readSync degrades those reads to
// undefined; Solid re-runs the memos once bootstrap settles, so the UI
// fills in instead of hitting the error boundary. It also swallows the
// no-server throw, which is the desired launcher behavior: the Cloud tab
// is the server onboarding, not a crash screen.
export function readSync<T>(accessor: () => T): T | undefined {
  try {
    return accessor() ?? undefined
  } catch {
    return undefined
  }
}
