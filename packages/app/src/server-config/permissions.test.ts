import { describe, expect, test } from "bun:test"
import {
  clonePermissionModel,
  parsePermissionConfig,
  permissionModelsEqual,
  serializePermissionModel,
} from "./permissions"

describe("permission model", () => {
  test("parses action shorthand, nested wildcards, and pattern rules", () => {
    const model = parsePermissionConfig({
      "*": "ask",
      edit: "allow",
      bash: { "*": "deny", "git commit*": "allow" },
      read: { "*.env": "deny" },
      junk: 42,
    })
    expect(model.global).toBe("ask")
    expect(model.keys.edit).toEqual({ action: "allow", patterns: [] })
    expect(model.keys.bash).toEqual({ action: "deny", patterns: [{ pattern: "git commit*", action: "allow" }] })
    expect(model.keys.read).toEqual({ action: null, patterns: [{ pattern: "*.env", action: "deny" }] })
    expect(model.keys.junk).toBeUndefined()
  })

  test("serialize is canonical and lossless (inherit = key omitted)", () => {
    const model = parsePermissionConfig({ bash: { "*": "ask", "rm*": "deny" }, edit: "allow" })
    expect(serializePermissionModel(model)).toEqual({ bash: { "*": "ask", "rm*": "deny" }, edit: "allow" })
    const roundTrip = parsePermissionConfig(serializePermissionModel(model))
    expect(permissionModelsEqual(model, roundTrip)).toBe(true)
  })

  test("empty and inherit-only models serialize to null", () => {
    expect(serializePermissionModel({ global: null, keys: { edit: { action: null, patterns: [] } } })).toBeNull()
  })

  test("string config collapses to global", () => {
    expect(parsePermissionConfig("deny").global).toBe("deny")
    expect(parsePermissionConfig("bogus").global).toBeNull()
  })

  test("clone is deep", () => {
    const model = parsePermissionConfig({ bash: "ask" })
    const copy = clonePermissionModel(model)
    copy.keys.bash.action = "allow"
    expect(model.keys.bash.action).toBe("ask")
  })
})
