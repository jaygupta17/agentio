import { describe, expect, test } from "bun:test"
import { bootEnvs, connectServe, isAllowedCorsOrigin, parseKeys } from "./provision"
import type { ServerConnection } from "@/context/server"

describe("parseKeys", () => {
  test("parses provider=key lines, ignoring comments/blank/junk", () => {
    expect(parseKeys("anthropic=sk-ant-1\n\n#comment\n=missing\nnoequals\nopenai= okey ")).toEqual({
      anthropic: "sk-ant-1",
      openai: "okey",
    })
  })

  test("splits on the first equals only", () => {
    expect(parseKeys("xai=x=y")).toEqual({ xai: "x=y" })
  })
})

describe("isAllowedCorsOrigin", () => {
  test("accepts https, loopback http, and native shell origins", () => {
    expect(isAllowedCorsOrigin("https://launcher.example.com")).toBe(true)
    expect(isAllowedCorsOrigin("https://example.test:8443")).toBe(true)
    expect(isAllowedCorsOrigin("http://localhost:4444")).toBe(true)
    expect(isAllowedCorsOrigin("http://127.0.0.1:3000")).toBe(true)
    expect(isAllowedCorsOrigin("tauri://localhost")).toBe(true)
    expect(isAllowedCorsOrigin("capacitor://localhost")).toBe(true)
    expect(isAllowedCorsOrigin("http://tauri.localhost")).toBe(true)
  })

  test("rejects everything else (boot.sh would exit 1 on them)", () => {
    expect(isAllowedCorsOrigin("http://evil.example.com")).toBe(false)
    expect(isAllowedCorsOrigin("https://x.test/path")).toBe(false)
    expect(isAllowedCorsOrigin("null")).toBe(false)
    expect(isAllowedCorsOrigin("")).toBe(false)
  })
})

describe("bootEnvs", () => {
  test("assembles the boot.sh env contract and filters unsafe origins", () => {
    const envs = bootEnvs({
      devicePassword: "dev-pass",
      llmKeys: { anthropic: "sk-1" },
      corsOrigins: ["http://evil.example.com", "https://agentio.example.com"],
    })
    expect(envs.OPENCODE_SERVER_PASSWORD).toBe("dev-pass")
    expect(JSON.parse(envs.OPENCODE_AUTH_CONTENT)).toEqual({ anthropic: { type: "api", key: "sk-1" } })
    expect(envs.AGENTIO_CORS_ORIGINS).toBe("https://agentio.example.com")
  })

  test("loopback dev origins survive the filter; unsafe ones drop out", () => {
    const envs = bootEnvs({
      devicePassword: "p",
      llmKeys: {},
      corsOrigins: ["http://localhost:4444", "http://evil.example.com"],
    })
    expect(envs.AGENTIO_CORS_ORIGINS).toBe("http://localhost:4444")
    expect("AGENTIO_CORS_ORIGINS" in bootEnvs({ devicePassword: "p", llmKeys: {}, corsOrigins: [] })).toBe(false)
  })
})

function fakeServer(events: string[]) {
  const added: ServerConnection.Http[] = []
  return {
    added,
    ctx: {
      saveSecret: async (url: string) => {
        events.push(`save:${url}`)
      },
      add: (conn: ServerConnection.Http) => {
        events.push("add")
        added.push(conn)
        return conn
      },
    },
  }
}

describe("connectServe", () => {
  test("registers a healthy server: vault first, then store", async () => {
    const events: string[] = []
    const { added, ctx } = fakeServer(events)
    const result = await connectServe({
      server: ctx,
      url: "https://abc-4096.e2b.dev/",
      username: "opencode",
      password: "dev-pass",
      persistSecrets: async () => {
        events.push("persist")
      },
      checkHealth: async () => ({ healthy: true, version: "1.18.27" }),
    })
    expect(result).toEqual({ ok: true, version: "1.18.27" })
    expect(events).toEqual(["persist", "save:https://abc-4096.e2b.dev", "add"])
    expect(added[0]?.http.url).toBe("https://abc-4096.e2b.dev")
  })

  test("unreachable servers never touch the store or the vault", async () => {
    const events: string[] = []
    const { added, ctx } = fakeServer(events)
    const result = await connectServe({
      server: ctx,
      url: "https://down.test",
      password: "p",
      checkHealth: async () => ({ healthy: false }),
    })
    expect(result.ok).toBe(false)
    expect(events).toEqual([])
    expect(added).toHaveLength(0)
  })

  test("blank URLs are rejected before any network work", async () => {
    const events: string[] = []
    const { ctx } = fakeServer(events)
    const result = await connectServe({
      server: ctx,
      url: "   ",
      checkHealth: async () => ({ healthy: true }),
    })
    expect(result.ok).toBe(false)
    expect(result.error?.key).toBe("dialog.server.add.error")
    expect(events).toEqual([])
  })
})
