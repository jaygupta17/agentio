import { describe, expect, test } from "bun:test"
import {
  buildAgentMarkdown,
  buildCommandMarkdown,
  buildSkillMarkdown,
  parseAgentMarkdown,
  parseCommandMarkdown,
  parseFrontmatterMarkdown,
  parseSkillMarkdown,
} from "./codecs"

describe("frontmatter", () => {
  test("parses and builds round-trip with body", () => {
    const text = '---\ndescription: "hi"\nmode: subagent\n---\n\nBe nice.\n'
    const doc = parseFrontmatterMarkdown(text)
    expect(doc.data.description).toBe("hi")
    expect(doc.body).toBe("Be nice.")
  })

  test("text without frontmatter is a plain body", () => {
    expect(parseFrontmatterMarkdown("just prose")).toEqual({ data: {}, body: "just prose" })
  })

  test("invalid yaml degrades to empty data instead of throwing", () => {
    expect(parseFrontmatterMarkdown("---\n: : bad\n---\nbody").data).toEqual({})
  })
})

describe("agent files", () => {
  test("frontmatter config + body prompt; name/prompt not duplicated", () => {
    const md = buildAgentMarkdown(
      { description: "code reviewer", mode: "subagent", temperature: 0.2, name: "ignored" as never, prompt: "ignored" as never },
      "Review everything.",
    )
    expect(md).toContain("mode: subagent")
    expect(md).not.toContain("ignored")
    const parsed = parseAgentMarkdown(md)
    expect(parsed.description).toBe("code reviewer")
    expect(parsed.prompt).toBe("Review everything.")
  })

  test("body overrides an inline prompt key, exactly like the server merge", () => {
    expect(parseAgentMarkdown('---\nprompt: from key\ndescription: x\n---\nactual body').prompt).toBe("actual body")
    expect(parseAgentMarkdown('---\nprompt: from key\ndescription: x\n---\n').prompt).toBe("")
  })

  test("permission object survives round-trip", () => {
    const md = buildAgentMarkdown({ permission: { bash: "ask", edit: { "*": "deny" } } }, "p")
    expect(parseAgentMarkdown(md).permission).toEqual({ bash: "ask", edit: { "*": "deny" } })
  })
})

describe("skill files", () => {
  test("SKILL.md requires name; description optional", () => {
    const text = buildSkillMarkdown({ name: "deploy", description: "ship it", instructions: "step 1\nstep 2" })
    expect(text).toContain("name: deploy")
    const parsed = parseSkillMarkdown(text)
    expect(parsed).toEqual({ name: "deploy", description: "ship it", instructions: "step 1\nstep 2" })
  })

  test("missing name -> undefined (loader would skip)", () => {
    expect(parseSkillMarkdown("---\ndescription: x\n---\nbody")).toBeUndefined()
  })
})

describe("command files", () => {
  test("body template wins; explicit template key also honored", () => {
    const built = buildCommandMarkdown({ description: "deploy", agent: "build" }, "run $ARGUMENTS")
    expect(parseCommandMarkdown(built)).toEqual({ config: { description: "deploy", agent: "build" }, template: "run $ARGUMENTS" })
    expect(parseCommandMarkdown('---\ntemplate: inline\n---\nbody').template).toBe("inline")
  })
})
