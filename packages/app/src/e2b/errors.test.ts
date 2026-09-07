import { describe, expect, test } from "bun:test"
import { classifyError, redactSecrets } from "./errors"

describe("classifyError", () => {
  test("maps status-ish SDK tagged unions to actionable keys", () => {
    expect(classifyError({ message: "status 401 Unauthorized" }).key).toBe("e2b.error.auth")
    expect(classifyError({ _tag: "SessionNotFoundError", message: "gone" }).key).toBe("e2b.error.notFound")
    expect(classifyError({ _tag: "ConflictError", message: "locked" }).key).toBe("e2b.error.busy")
    expect(classifyError(new TypeError("Failed to fetch")).key).toBe("e2b.error.unreachable")
    expect(classifyError({ message: "HTTP 503 ServiceUnavailable" }).key).toBe("e2b.error.server")
  })

  test("falls back to a redacted, truncated raw message", () => {
    const err = classifyError(new Error(`boom e2b_SUPERSECRET https://x.test?auth_token=abc ${"y".repeat(300)}`))
    expect(err.key).toBe("e2b.error.raw")
    const message = String(err.params?.message ?? "")
    expect(message).toContain("e2b_***")
    expect(message).toContain("auth_token=***")
    expect(message).not.toContain("SUPERSECRET")
    expect(message.length).toBeLessThanOrEqual(200)
  })

  test("handles nullish and empty errors", () => {
    expect(classifyError(null).key).toBe("e2b.error.raw")
    expect(classifyError("").key).toBe("e2b.error.raw")
  })
})

describe("redactSecrets", () => {
  test("scrubs credential-shaped substrings", () => {
    expect(redactSecrets("Basic dXNlcjpwYXNz and Bearer tok.en.x and e2b_key123")).toBe(
      "Basic *** and Bearer *** and e2b_***",
    )
  })
})
