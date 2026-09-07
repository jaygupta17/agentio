// agentio "Server config" area: manage the connected opencode server —
// permissions, agents/subagents, commands, MCP, skills, plugins. Scope =
// global config or one of the server's projects. File-backed power features
// (deletes, SKILL.md authoring) light up only on E2B servers; remote scopes
// stay fully usable for everything the HTTP API supports, with clear
// read-only affordances where it doesn't.

import { For, Show, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useQueryClient } from "@tanstack/solid-query"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useServer, serverName } from "@/context/server"
import { loadVault } from "@/e2b/vault"
import { classifyError } from "@/e2b/errors"
import { applyPendingReloads, pendingReloadCount } from "@/server-config/reload"
import { useConfigScope } from "./shared"
import { PermissionsPanel } from "./permissions-panel"
import { AgentsPanel } from "./agents-panel"
import { CommandsPanel } from "./commands-panel"
import { McpPanel } from "./mcp-panel"
import { SkillsPanel } from "./skills-panel"
import { PluginsPanel } from "./plugins-panel"

type Section = "permissions" | "agents" | "commands" | "mcp" | "skills" | "plugins"

const SECTIONS: Section[] = ["permissions", "agents", "commands", "mcp", "skills", "plugins"]

export function ServerConfigPage() {
  const language = useLanguage()
  const server = useServer()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dialog = useDialog()
  const [state, setState] = createStore({
    section: "permissions" as Section,
    directory: "",
    applying: false,
    error: "",
  })

  const [vault] = createResource(() => loadVault().catch(() => null))
  const scope = useConfigScope(
    () => state.directory,
    () => vault()?.e2bKey ?? "",
  )

  const reloads = createMemo(() => pendingReloadCount())

  async function applyReloads() {
    setState({ applying: true, error: "" })
    try {
      await applyPendingReloads(() => {
        const target = scope.target()
        const dirs = [state.directory, ...scope.projects().map((project) => project.worktree)]
        return [...new Set(dirs)].filter(Boolean).map((directory) => ({ ...target, directory }))
      })
      await queryClient.invalidateQueries({ queryKey: ["server-config"] })
    } catch (err) {
      setState("error", language.t(classifyError(err).key, classifyError(err).params ?? {}))
    } finally {
      setState("applying", false)
    }
  }

  const title = (section: Section) =>
    ({
      permissions: language.t("config.permissions"),
      agents: language.t("config.agents.title"),
      commands: language.t("config.commands.title"),
      mcp: "MCP",
      skills: language.t("config.skills.title"),
      plugins: language.t("config.plugins"),
    })[section]

  return (
    <div class="flex flex-col flex-1 min-h-0 w-full">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-border-weak shrink-0">
        <button type="button" class="p-1 text-text-weak hover:text-text-strong" onClick={() => navigate("/")} aria-label={language.t("config.back")}>
          <Icon name="chevron-left" class="size-5" />
        </button>
        <h1 class="text-14-medium text-text-strong flex-1 min-w-0 truncate">
          {language.t("config.title")}
          <span class="text-text-weak"> · {serverName()}</span>
        </h1>
        <Show when={reloads() > 0}>
          <button
            type="button"
            disabled={state.applying}
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-raised-base border border-border-weak text-12-medium text-text-strong disabled:opacity-50"
            onClick={() => void applyReloads()}
          >
            <span class="size-2 rounded-full bg-text-warn" />
            {language.t("config.applyReload", { count: reloads() })}
          </button>
        </Show>
      </div>

      <div class="flex gap-2 px-4 py-2 border-b border-border-weak items-center shrink-0 overflow-x-auto">
        <span class="text-12-regular text-text-weak shrink-0">{language.t("config.scope")}</span>
        <button
          type="button"
          class={`shrink-0 px-2.5 py-1 rounded-md text-12-medium border ${
            state.directory === "" ? "border-border-strong bg-surface-raised-base text-text-strong" : "border-border-weak text-text-weak"
          }`}
          onClick={() => setState("directory", "")}
        >
          {language.t("config.scopeGlobal")}
        </button>
        <For each={scope.projects()}>
          {(project) => {
            const label = () => project.worktree.split("/").filter(Boolean).pop() ?? project.worktree
            return (
              <button
                type="button"
                class={`shrink-0 px-2.5 py-1 rounded-md text-12-medium border truncate max-w-40 ${
                  state.directory === project.worktree ? "border-border-strong bg-surface-raised-base text-text-strong" : "border-border-weak text-text-weak"
                }`}
                onClick={() => setState("directory", project.worktree)}
              >
                {label()}
              </button>
            )
          }}
        </For>
      </div>

      <div class="flex flex-1 min-h-0">
        <nav class="hidden md:flex flex-col gap-1 w-44 shrink-0 p-3">
          <For each={SECTIONS}>
            {(section) => (
              <button
                type="button"
                class={`px-3 py-2 rounded-lg text-left text-12-medium transition-colors ${
                  state.section === section ? "bg-surface-raised-base text-text-strong" : "text-text-weak hover:text-text-base"
                }`}
                onClick={() => setState("section", section)}
              >
                {title(section)}
              </button>
            )}
          </For>
          <button
            type="button"
            class="mt-2 px-3 py-2 rounded-lg text-left text-12-medium text-text-weak hover:text-text-base"
            onClick={() => {
              void import("@/components/settings-v2/dialog-settings-v2").then((m) => {
                dialog.show(() => <m.DialogSettings defaultValue="providers" />)
              })
            }}
          >
            {language.t("config.providerKeys")}
          </button>
        </nav>
        <div class="flex-1 min-w-0 overflow-y-auto p-4">
          <nav class="flex md:hidden gap-1 overflow-x-auto pb-3">
            <For each={SECTIONS}>
              {(section) => (
                <button
                  type="button"
                  class={`shrink-0 px-2.5 py-1 rounded-md text-12-medium border ${
                    state.section === section ? "border-border-strong bg-surface-raised-base text-text-strong" : "border-border-weak text-text-weak"
                  }`}
                  onClick={() => setState("section", section)}
                >
                  {title(section)}
                </button>
              )}
            </For>
          </nav>
          <Show when={state.error}>
            <span class="text-12-regular text-text-danger block mb-3">{state.error}</span>
          </Show>
          <Show when={!state.directory || scope.fileCapable()} fallback={
            <div class="flex flex-col items-start gap-2 rounded-lg border border-border-weak bg-surface-base px-3 py-2">
              <span class="text-12-regular text-text-base">{language.t("config.projectNeedsSandbox")}</span>
              <button type="button" class="text-12-medium text-text-strong underline" onClick={() => setState("directory", "")}>
                {language.t("config.scopeGlobal")}
              </button>
            </div>
          }>
          <Show when={state.section === "permissions"}>
            <PermissionsPanel scope={scope} />
          </Show>
          <Show when={state.section === "agents"}>
            <AgentsPanel scope={scope} />
          </Show>
          <Show when={state.section === "commands"}>
            <CommandsPanel scope={scope} />
          </Show>
          <Show when={state.section === "mcp"}>
            <McpPanel scope={scope} />
          </Show>
          <Show when={state.section === "skills"}>
            <SkillsPanel scope={scope} />
          </Show>
          <Show when={state.section === "plugins"}>
            <PluginsPanel scope={scope} />
          </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
