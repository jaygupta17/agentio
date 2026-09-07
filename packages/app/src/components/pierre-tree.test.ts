import { expect, test } from "bun:test"
import { FileTree, type FileTreeDirectoryHandle } from "@pierre/trees"

// Compat (agentio fork): @pierre/trees≤1.0.0-beta.6 has no onExpansionChange
// hook — assert expand/collapse state through the directory handle instead.
// Upstream test covers the unreleased hook; restore it when the pin advances.
test("directory handle tracks expansion state", () => {
  const tree = new FileTree({
    paths: ["src/"],
  })

  const src = tree.getItem("src/")
  if (!src || !src.isDirectory()) throw new Error("Expected src to be a directory")
  const directory = src as FileTreeDirectoryHandle

  directory.expand()
  expect(directory.isExpanded()).toBe(true)
  directory.collapse()
  expect(directory.isExpanded()).toBe(false)
  tree.cleanUp()
})
