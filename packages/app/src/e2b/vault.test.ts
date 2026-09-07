import { describe, expect, test } from "bun:test"
import { buildAuthContent, generatePassword, loadVault, memoryBackend, saveVault, updateVault, type VaultSecrets } from "./vault"

describe("vault", () => {
  test("round-trips secrets including the per-server credentials map", async () => {
    const backend = memoryBackend()
    await saveVault(
      {
        password: "dev-pass",
        e2bKey: "e2b_test",
        llmKeys: { anthropic: "sk-ant-1" },
        servers: { "https://abc-4096.e2b.dev": { username: "opencode", password: "dev-pass" } },
      },
      backend,
    )
    const loaded = await loadVault(backend)
    expect(loaded).toEqual({
      password: "dev-pass",
      e2bKey: "e2b_test",
      llmKeys: { anthropic: "sk-ant-1" },
      servers: { "https://abc-4096.e2b.dev": { username: "opencode", password: "dev-pass" } },
    })
  })

  test("drops malformed server entries instead of failing the whole vault", async () => {
    const backend = memoryBackend()
    await saveVault(
      {
        password: "p",
        e2bKey: "k",
        llmKeys: {},
        servers: {
          "https://good.test": { password: "x" },
          "https://empty.test": { password: "" },
          "https://junk.test": "nope" as unknown as { password: string },
        },
      },
      backend,
    )
    const loaded = await loadVault(backend)
    expect(Object.keys(loaded?.servers ?? {})).toEqual(["https://good.test"])
  })

  test("legacy vault shape (no servers key) loads with an empty map", async () => {
    const backend = memoryBackend()
    // JSON.stringify drops undefined values — mirrors records saved pre-servers-map.
    await saveVault(
      { password: "p", e2bKey: "k", llmKeys: {}, servers: undefined } as unknown as VaultSecrets,
      backend,
    )
    const loaded = await loadVault(backend)
    expect(loaded?.servers).toEqual({})
  })

  test("updateVault merges so concurrent writers don't clobber fields", async () => {
    const backend = memoryBackend()
    await saveVault({ password: "p", e2bKey: "k", llmKeys: { anthropic: "a" }, servers: {} }, backend)
    await updateVault(
      (v) => ({ ...v, servers: { ...v.servers, "https://x.test": { password: "s" } } }),
      backend,
    )
    await updateVault((v) => ({ ...v, e2bKey: "k2" }), backend)
    const loaded = await loadVault(backend)
    expect(loaded?.e2bKey).toBe("k2")
    expect(loaded?.servers["https://x.test"]?.password).toBe("s")
    expect(loaded?.llmKeys.anthropic).toBe("a")
  })

  test("generatePassword is url-safe and long enough", () => {
    const p = generatePassword()
    expect(p).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })

  test("buildAuthContent emits the serve auth schema", () => {
    const content = JSON.parse(buildAuthContent({ anthropic: " sk-1 ", " ": "x", openai: "o" }))
    expect(content).toEqual({ anthropic: { type: "api", key: "sk-1" }, openai: { type: "api", key: "o" } })
  })
})
