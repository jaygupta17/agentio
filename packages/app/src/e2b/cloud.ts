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
   * Raw sandbox filesystem access (E2B files API — opencode serve exposes no
   * file write in v1.18.27). NEVER call with user-supplied paths: the jail
   * lives in server-config/files.ts (resolveConfigPath), which every UI flow
   * goes through before reaching this provider.
   */
  readFile(sandboxId: string, absolutePath: string): Promise<string>
  writeFile(sandboxId: string, absolutePath: string, content: string): Promise<void>
  removeFile(sandboxId: string, absolutePath: string): Promise<void>
  existsFile(sandboxId: string, absolutePath: string): Promise<boolean>
  listDir(sandboxId: string, absolutePath: string): Promise<WorkspaceFile[]>
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
    readFile: async (sandboxId: string, absolutePath: string) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      return sbx.files.read(absolutePath)
    },
    writeFile: async (sandboxId: string, absolutePath: string, content: string) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      await sbx.files.write(absolutePath, content)
    },
    removeFile: async (sandboxId: string, absolutePath: string) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      await sbx.files.remove(absolutePath)
    },
    existsFile: async (sandboxId: string, absolutePath: string) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      return sbx.files.exists(absolutePath)
    },
    listDir: async (sandboxId: string, absolutePath: string) => {
      const { Sandbox } = await e2b()
      const sbx = await Sandbox.connect(sandboxId, opts)
      const entries = await sbx.files.list(absolutePath)
      return entries.map((e) => ({ name: e.name, path: e.path, isDir: e.type === "dir" }))
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
