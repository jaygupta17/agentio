// agentio launcher fork — copied verbatim from `app/web/src/lib/cloud.ts`
// (opencode v1.18.27 pin). E2B seam: UI never imports the E2B SDK directly.
// CloudProvider seam — E2B impl first, Modal later. UI never imports the
// E2B SDK directly.
//
// Verified against e2b@2.46.1 .d.ts:
//   Sandbox.list(opts) → paginator (hasNext/nextItems), running+paused
//   Sandbox.connect(id) auto-resumes paused sandboxes
//   sandbox.getHost(port) → host (caller prefixes https://)
//   Sandbox.pause(id, {keepMemory:false}) → FS-only snapshot (spec default)
//   Sandbox.getInfo(id) → {state, endAt, templateId, ...}
//
// NOTE: `e2b` is dynamically imported per call, never statically — the SDK
// is ~340 KiB and only needed for E2B flows. Static import would drag it
// into the initial bundle for every visitor.
type E2B = typeof import("e2b");
const e2b = (): Promise<E2B> => import("e2b");

export interface CloudSandbox {
  id: string
  templateId: string
  name?: string
  state: "running" | "paused" | string
  startedAt: Date
  endAt: Date
}

export interface WorkspaceFile {
  name: string
  path: string
  isDir: boolean
}

export interface CloudProvider {
  listSandboxes(): Promise<CloudSandbox[]>
  getSandbox(sandboxId: string): Promise<CloudSandbox>
  /** Connect (auto-resumes if paused) and return the public serve URL. */
  getServeUrl(sandboxId: string, port: number): Promise<string>
  pauseSandbox(sandboxId: string): Promise<void>
  /** Provision from a template. Manual per spec — called only from explicit UI. */
  createSandbox(template: string, timeoutMs: number): Promise<CloudSandbox>
  /**
   * Run boot.sh inside (background) with the serve envs. Secrets travel as
   * process env of that command only — never baked into the template.
   */
  startServe(sandboxId: string, envs: Record<string, string>): Promise<void>
  /**
   * Direct workspace file access (E2B files API — opencode serve exposes no
   * write endpoint in v1.18.27). Scoped to `<workspace>/.opencode/` markdown
   * ONLY; anything else throws before any network call. Powers agent/skill/
   * command .md authoring that PATCH /config cannot express.
   */
  listMarkdownDir(sandboxId: string, workspaceDir: string, relPath: string): Promise<WorkspaceFile[]>
  readMarkdownFile(sandboxId: string, workspaceDir: string, relPath: string): Promise<string>
  writeMarkdownFile(sandboxId: string, workspaceDir: string, relPath: string, content: string): Promise<void>
}

/**
 * Resolve a workspace-relative path and confine it to .opencode/ markdown.
 * Pure — tested. Rejects absolute paths, traversal, non-.md, and anything
 * outside the .opencode tree.
 */
export function resolveMarkdownDir(workspaceDir: string, relPath: string): string {
  const clean = relPath.split("/").filter((s) => s && s !== ".")
  if (clean.some((s) => s === "..")) throw new Error(`refusing traversal: ${relPath}`)
  if (clean[0] !== ".opencode") throw new Error(`confined to .opencode/: ${relPath}`)
  const root = workspaceDir.replace(/\/$/, "")
  if (!root.startsWith("/")) throw new Error(`workspace must be absolute: ${workspaceDir}`)
  return clean.length === 1 ? `${root}/${clean[0]}` : `${root}/${clean.join("/")}`
}

export function resolveMarkdownPath(workspaceDir: string, relPath: string): string {
  const full = resolveMarkdownDir(workspaceDir, relPath)
  const last = full.slice(full.lastIndexOf("/") + 1)
  if (!last.endsWith(".md")) throw new Error(`markdown only: ${relPath}`)
  return full
}

export function createE2BProvider(apiKey: string): CloudProvider {
  const opts = { apiKey }
  return {
    listSandboxes: async () => {
      const out: CloudSandbox[] = []
      const paginator = (await e2b()).Sandbox.list(opts)
      while (paginator.hasNext) {
        const page = await paginator.nextItems()
        out.push(...page.map(toCloud))
      }
      return out
    },
    getSandbox: async (sandboxId: string) =>
      toCloud(await (await e2b()).Sandbox.getInfo(sandboxId, opts)),
    getServeUrl: async (sandboxId: string, port: number) => {
      const sbx = await (await e2b()).Sandbox.connect(sandboxId, opts)
      return "https://" + sbx.getHost(port)
    },
    // FS-only pause per spec: files survive, procs don't. Restart serve
    // via startServe after resume (SandboxPanel offers it in the UI).
    pauseSandbox: async (sandboxId: string) => {
      await (await e2b()).Sandbox.pause(sandboxId, { ...opts, keepMemory: false })
    },
    createSandbox: async (template: string, timeoutMs: number) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.create(template, { ...opts, timeoutMs })
      return toCloud(await Sandbox.getInfo(sbx.sandboxId, opts))
    },
    startServe: async (sandboxId: string, envs: Record<string, string>) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      await sbx.commands.run("/opt/agentio/boot.sh", { background: true, envs })
    },
    listMarkdownDir: async (sandboxId: string, workspaceDir: string, relPath: string) => {
      const dir = resolveMarkdownDir(workspaceDir, relPath || ".opencode")
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      const entries = await sbx.files.list(dir)
      return entries.map((e) => ({ name: e.name, path: e.path, isDir: e.type === "dir" }))
    },
    readMarkdownFile: async (sandboxId: string, workspaceDir: string, relPath: string) => {
      const full = resolveMarkdownPath(workspaceDir, relPath)
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      return sbx.files.read(full)
    },
    writeMarkdownFile: async (
      sandboxId: string,
      workspaceDir: string,
      relPath: string,
      content: string,
    ) => {
      const full = resolveMarkdownPath(workspaceDir, relPath)
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      await sbx.files.write(full, content)
    },
  }
}

/**
 * Poll unauthenticated /global/health until serve answers with a version.
 * Used after create/start-serve and after FS-only resume (cold boot takes a
 * while). Cancellable via signal; throws the last error on timeout.
 */
export async function waitForServeVersion(
  baseUrl: string,
  opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { timeoutMs = 90000, intervalMs = 2000, signal } = opts
  const root = baseUrl.replace(/\/$/, "")
  const start = Date.now()
  let lastErr: unknown = new Error("serve did not come up in time")
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    try {
      const res = await fetch(`${root}/global/health`, { signal })
      if (res.ok) {
        const body = (await res.json()) as { version?: unknown }
        if (typeof body.version === "string" && body.version) return body.version
      }
    } catch (err) {
      if (signal?.aborted) throw err
      lastErr = err
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs)
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(new DOMException("Aborted", "AbortError"))
        },
        { once: true },
      )
    })
  }
  throw lastErr instanceof Error ? lastErr : new Error("serve did not come up in time")
}

function toCloud(info: {  sandboxId: string
  templateId: string
  name?: string
  state: string
  startedAt: Date
  endAt: Date
}): CloudSandbox {
  return {
    id: info.sandboxId,
    templateId: info.templateId,
    name: info.name,
    state: info.state,
    startedAt: info.startedAt,
    endAt: info.endAt,
  }
}
