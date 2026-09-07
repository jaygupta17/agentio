import { describe, expect, test } from "bun:test"
import { ConfigPathError, createJailedConfigFiles, editJsoncPath, getJsoncPath, resolveConfigDir, resolveConfigPath } from "./files"

const roots = {
  configDir: "/home/user/.config/opencode",
  worktreeDirs: ["/home/user/workspace/app"],
}

const ok = (p: string) => resolveConfigPath(p, roots)

describe("resolveConfigPath", () => {
  test("allows opencode's own config locations", () => {
    expect(ok("/home/user/.config/opencode/opencode.json").kind).toBe("global-config-file")
    expect(ok("/home/user/.config/opencode/AGENTS.md").kind).toBe("global-config-file")
    expect(ok("/home/user/.config/opencode/agents/deploy/x.md").kind).toBe("global-entity")
    expect(ok("/home/user/.config/opencode/skills/deploy/SKILL.md").kind).toBe("global-entity")
    expect(ok("/home/user/.config/opencode/plugins/hooks.ts").kind).toBe("global-entity")
    expect(ok("/home/user/workspace/app/opencode.jsonc").kind).toBe("project-config-file")
    expect(ok("/home/user/workspace/app/AGENTS.md").kind).toBe("project-config-file")
    expect(ok("/home/user/workspace/app/.opencode/opencode.json").kind).toBe("project-config-file")
    expect(ok("/home/user/workspace/app/.opencode/agent/build.md").kind).toBe("project-dot-opencode")
    expect(ok("/home/user/workspace/app/.opencode/skills/x/SKILL.md").kind).toBe("project-dot-opencode")
  })

  test("rejects traversal even when normalized back inside", () => {
    expect(() => ok("/home/user/.config/opencode/agent/../../evil.md")).toThrow(ConfigPathError)
    expect(() => ok("/home/user/workspace/app/../../../etc/shadow.json")).toThrow(ConfigPathError)
  })

  test("rejects outside paths, wrong types, and sneaky files", () => {
    expect(() => ok("/etc/passwd.md")).toThrow(ConfigPathError)
    expect(() => ok("/home/user/.config/opencode/config.md")).toThrow(ConfigPathError) // md not a global config file
    expect(() => ok("/home/user/.config/opencode/node_modules/evil.ts")).toThrow(ConfigPathError)
    expect(() => ok("/home/user/workspace/app/src/main.ts")).toThrow(ConfigPathError)
    expect(() => ok("/home/user/workspace/app/.opencode/random/x.rs")).toThrow(ConfigPathError)
    expect(() => ok("relative/opencode.json")).toThrow(ConfigPathError)
    expect(() => ok("/home/user/.config/opencode/.env")).toThrow(ConfigPathError)
  })
})

describe("resolveConfigDir", () => {
  test("lists config and worktree dirs, blocks node_modules", () => {
    expect(resolveConfigDir("/home/user/.config/opencode", roots)).toBe("/home/user/.config/opencode")
    expect(resolveConfigDir("/home/user/workspace/app/.opencode/skills", roots)).toBe(
      "/home/user/workspace/app/.opencode/skills",
    )
    expect(() => resolveConfigDir("/home/user/.config/opencode/node_modules", roots)).toThrow(ConfigPathError)
    expect(() => resolveConfigDir("/etc", roots)).toThrow(ConfigPathError)
  })
})

describe("jailed files wrapper", () => {
  test("touches the provider only after the jail passes", async () => {
    const writes: string[] = []
    const provider = {
      readFile: async (_id: string, p: string) => `content:${p}`,
      writeFile: async (_id: string, p: string) => void writes.push(p),
      removeFile: async (_id: string, p: string) => void writes.push(`rm:${p}`),
      existsFile: async () => true,
      listDir: async () => [],
    }
    const files = createJailedConfigFiles(provider, "sbx1", () => roots)
    expect(await files.read("/home/user/.config/opencode/opencode.json")).toBe(
      "content:/home/user/.config/opencode/opencode.json",
    )
    await files.write("/home/user/workspace/app/.opencode/agent/x.md", "# hi")
    expect(writes).toEqual(["/home/user/workspace/app/.opencode/agent/x.md"])
    expect(provider.writeFile.length).toBe(2)
    await expect(files.write("/home/user/secret.txt", "x")).rejects.toThrow(ConfigPathError)
    await expect(files.remove("/etc/cron.md")).rejects.toThrow(ConfigPathError)
    expect(writes).toEqual(["/home/user/workspace/app/.opencode/agent/x.md"])
  })
})

describe("jsonc editing", () => {
  const doc = `{
  // schema line
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "keep": { "mode": "primary" } // trailing comment must survive
  },
  "permission": { "bash": "ask" }
}`

  test("getJsoncPath reads through comments", () => {
    expect(getJsoncPath<unknown>(doc, ["agent", "keep", "mode"])).toBe("primary")
    expect(getJsoncPath<unknown>(doc, ["missing"])).toBeUndefined()
  })

  test("editJsoncPath sets a nested key and preserves unrelated comments", () => {
    const next = editJsoncPath(doc, ["agent", "newone"], { mode: "subagent" })
    expect(next).toContain("// trailing comment must survive")
    expect(getJsoncPath<unknown>(next, ["agent", "newone", "mode"])).toBe("subagent")
    expect(getJsoncPath<unknown>(next, ["agent", "keep", "mode"])).toBe("primary")
  })

  test("editJsoncPath deletes with undefined", () => {
    const next = editJsoncPath(doc, ["agent", "keep"], undefined)
    expect(getJsoncPath<unknown>(next, ["agent", "keep"])).toBeUndefined()
    expect(getJsoncPath<"ask">(next, ["permission", "bash"])).toBe("ask")
  })
})
