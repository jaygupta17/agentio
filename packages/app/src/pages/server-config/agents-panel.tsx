// Agents & subagents. Canonical storage is the `agent` config-key map
// (works on every server); E2B scopes additionally mirror to agent/*.md
// when the user opts in, and can DELETE entries (file edit).

import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { listAgents } from "@/server-config/api"
import type { AgentConfig } from "@/server-config/types"
import { parsePermissionConfig, serializePermissionModel, type PermissionModel } from "@/server-config/permissions"
import { buildAgentMarkdown } from "@/server-config/codecs"
import { configQueryKey, useErrorText, type ConfigScope } from "./shared"
import { createGlobalWriteService, createProjectWriteService, entityRoot, type WriteService } from "./write-service"
import { SANDBOX_CONFIG_DIR } from "@/server-config/files"
import { PermissionEditor } from "./permission-editor"
import { ActionChip, EmptyState, Field, NumberField, ReadOnlyBanner, SaveBar, SectionHeader } from "./atoms"

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

interface AgentForm {
  description: string
  mode: "primary" | "subagent" | "all"
  model: string
  variant: string
  temperature: number | undefined
  top_p: number | undefined
  prompt: string
  permission: PermissionModel
  mirrorToFile: boolean
}

const emptyForm = (): AgentForm => ({
  description: "",
  mode: "primary",
  model: "",
  variant: "",
  temperature: undefined,
  top_p: undefined,
  prompt: "",
  permission: parsePermissionConfig(undefined),
  mirrorToFile: false,
})

function formFromConfig(config: AgentConfig | undefined): AgentForm {
  return {
    ...emptyForm(),
    description: config?.description ?? "",
    mode: config?.mode ?? "primary",
    model: config?.model ?? "",
    variant: config?.variant ?? "",
    temperature: config?.temperature,
    top_p: config?.top_p,
    prompt: config?.prompt ?? "",
    permission: parsePermissionConfig(config?.permission),
  }
}

function configFromForm(form: AgentForm): AgentConfig {
  const config: AgentConfig = {}
  if (form.description.trim()) config.description = form.description.trim()
  if (form.mode !== "primary") config.mode = form.mode
  if (form.model.trim()) config.model = form.model.trim()
  if (form.variant.trim()) config.variant = form.variant.trim()
  if (form.temperature !== undefined) config.temperature = form.temperature
  if (form.top_p !== undefined) config.top_p = form.top_p
  if (form.prompt.trim()) config.prompt = form.prompt
  const permission = serializePermissionModel(form.permission)
  if (permission) config.permission = permission
  return config
}

export function AgentsPanel(props: { scope: ConfigScope }) {
  const language = useLanguage()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    selected: "" as string,
    isNew: false,
    draftName: "",
    error: "",
    notice: "",
    form: emptyForm(),
    baseline: emptyForm(),
    sourceAgents: {} as Record<string, AgentConfig>,
  })

  const writeService = createMemo<WriteService | undefined>(() => {
    const directory = props.scope.directory()
    const files = props.scope.files()
    if (directory) {
      if (!files) return undefined
      return createProjectWriteService({ files: () => files, worktree: directory }) as unknown as WriteService
    }
    return createGlobalWriteService({ target: props.scope.target(), files: props.scope.files, sandboxConfigDir: SANDBOX_CONFIG_DIR })
  })

  const agents = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "agents"),
    queryFn: () => listAgents(props.scope.target()),
    enabled: () => !!props.scope.serverKey(),
  }))

  const source = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "agents-source"),
    queryFn: () => writeService()?.read(),
    enabled: () => !!writeService(),
  }))

  createEffect(() => {
    const doc = source.data
    if (!doc) return
    setState("sourceAgents", (doc.agent ?? {}) as Record<string, AgentConfig>)
    if (state.selected && !state.isNew) {
      const loaded = formFromConfig(doc.agent?.[state.selected])
      // Don't clobber an in-progress edit; only re-sync the baseline.
      if (JSON.stringify(state.form) === JSON.stringify(state.baseline)) setState("form", loaded)
      setState("baseline", loaded)
    }
  })

  const resolved = createMemo(() => (agents.data ?? []).filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)))
  const selectedInfo = createMemo(() => resolved().find((a) => a.name === state.selected))

  function select(name: string) {
    setState({ selected: name, isNew: false, error: "", notice: "" })
    const fromSource = state.sourceAgents[name]
    const form = formFromConfig(fromSource)
    setState({ form, baseline: formFromConfig(fromSource) })
  }

  function startNew() {
    setState({ selected: "", isNew: true, draftName: "", error: "", notice: "", form: emptyForm(), baseline: emptyForm() })
  }

  const effectivePermission = createMemo(() => {
    const rules = selectedInfo()?.permission
    if (!Array.isArray(rules)) return undefined
    const map: Record<string, "allow" | "ask" | "deny"> = {}
    for (const rule of rules as Array<{ permission: string; action: string }>) {
      if (rule.permission === "*") continue
      if (rule.action === "allow" || rule.action === "ask" || rule.action === "deny") map[rule.permission] ??= rule.action
    }
    return map
  })

  const save = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service) throw new Error("scope not writable")
      const name = state.isNew ? state.draftName.trim() : state.selected
      if (!AGENT_NAME_RE.test(name)) throw new Error(language.t("config.agents.invalidName"))
      const config = configFromForm(state.form)
      await service.setSection("agent", { ...state.sourceAgents, [name]: config })
      if (state.form.mirrorToFile) {
        const files = props.scope.files()
        if (files) {
          const root = entityRoot({
            configDir: SANDBOX_CONFIG_DIR,
            ...(props.scope.directory() ? { worktree: props.scope.directory() } : {}),
          })
          await files.write(`${root}/agents/${name}.md`, buildAgentMarkdown({ ...config, prompt: undefined }, state.form.prompt))
        }
      }
      setState({ selected: name, isNew: false, baseline: state.form })
      await Promise.all([queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "agents") }), queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "agents-source") })])
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const remove = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service?.removePath) throw new Error(language.t("config.deleteRequiresSandbox"))
      const name = state.selected
      await service.removePath(["agent", name])
      const files = props.scope.files()
      if (files) {
        const root = entityRoot({
          configDir: SANDBOX_CONFIG_DIR,
          ...(props.scope.directory() ? { worktree: props.scope.directory() } : {}),
        })
        for (const dir of ["agents", "agent"]) {
          const path = `${root}/${dir}/${name}.md`
          if (await files.exists(path).catch(() => false)) await files.remove(path).catch(() => {})
        }
      }
      setState({ selected: "", form: emptyForm(), baseline: emptyForm(), notice: "" })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "agents").slice(0, 2) })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const dirty = createMemo(() => JSON.stringify(state.form) !== JSON.stringify(state.baseline))
  const nameTaken = createMemo(() => !!resolved().find((a) => a.name === state.draftName.trim()))

  return (
    <div class="flex gap-6 min-w-0 max-w-full">
      <div class="flex flex-col gap-1 w-56 shrink-0">
        <ButtonV2 variant="neutral" class="justify-start" onClick={startNew}>
          + {language.t("config.agents.new")}
        </ButtonV2>
        <For each={resolved()}>
          {(agent) => (
            <button
              type="button"
              onClick={() => select(agent.name)}
              class={`flex flex-col items-start px-3 py-2 rounded-lg text-left transition-colors ${
                state.selected === agent.name && !state.isNew ? "bg-surface-raised-base" : "hover:bg-surface-raised-base-hover"
              }`}
            >
              <span class="text-12-medium text-text-strong">{agent.name}</span>
              <span class="text-12-regular text-text-weak">
                {agent.mode}
                {agent.native ? ` · ${language.t("config.agents.builtIn")}` : ""}
              </span>
            </button>
          )}
        </For>
      </div>

      <div class="flex flex-col gap-4 min-w-0 flex-1">
        <Show when={!state.selected && !state.isNew}>
          <EmptyState text={language.t("config.pickAgent")} />
        </Show>

        <Show when={state.isNew}>
          <div class="flex flex-col gap-2">
            <Field label={language.t("config.agents.name")} hint={language.t("config.agents.nameHint")}>
              <TextInputV2
                appearance="large"
                class="!w-full self-stretch"
                value={state.draftName}
                onInput={(event) => setState("draftName", event.currentTarget.value)}
              />
            </Field>
            <Show when={state.draftName.trim() && nameTaken()}>
              <span class="text-12-regular text-text-danger">{language.t("config.agents.nameTaken")}</span>
            </Show>
          </div>
        </Show>

        <Show when={state.selected || state.isNew}>
          <SectionHeader title={state.isNew ? language.t("config.agents.new") : state.selected}>
            <Show when={!state.isNew && props.scope.fileCapable()}>
              <ButtonV2 variant="neutral" disabled={remove.isPending} onClick={() => void remove.mutate()}>
                {language.t("config.delete")}
              </ButtonV2>
            </Show>
          </SectionHeader>
          <Show when={selectedInfo()?.native}>
            <ReadOnlyBanner text={language.t("config.agents.overrideBuiltIn")} />
          </Show>
          <Show when={!props.scope.fileCapable()}>
            <ReadOnlyBanner text={language.t("config.agents.remoteDelete")} />
          </Show>

          <div class="grid grid-cols-2 gap-4">
            <Field label={language.t("config.agents.description")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.description} onInput={(e) => setState("form", "description", e.currentTarget.value)} />
            </Field>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-regular text-text-base">{language.t("config.agents.mode")}</span>
              <div class="flex items-center gap-1.5">
                <For each={["primary", "subagent", "all"] as const}>
                  {(mode) => (
                    <ActionChip selected={state.form.mode === mode} onClick={() => setState("form", "mode", mode)}>
                      {language.t(`config.agents.mode.${mode}` as "config.agents.mode.primary")}
                    </ActionChip>
                  )}
                </For>
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <Field label={language.t("config.agents.model")} hint={language.t("config.agents.modelHint")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.model} placeholder="anthropic/claude-…" onInput={(e) => setState("form", "model", e.currentTarget.value)} />
            </Field>
            <Field label={language.t("config.agents.variant")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.variant} onInput={(e) => setState("form", "variant", e.currentTarget.value)} />
            </Field>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <NumberField
              label={language.t("config.agents.temperature")}
              value={state.form.temperature}
              min={0}
              max={2}
              step={0.1}
              placeholder="0.7"
              onChange={(value) => setState("form", "temperature", value)}
            />
            <NumberField
              label={language.t("config.agents.topP")}
              value={state.form.top_p}
              min={0}
              max={1}
              step={0.05}
              placeholder="0.9"
              onChange={(value) => setState("form", "top_p", value)}
            />
          </div>
          <Field label={language.t("config.agents.prompt")}>
            <TextareaV2
              rows={8}
              class="w-full font-mono"
              value={state.form.prompt}
              onInput={(e) => setState("form", "prompt", e.currentTarget.value)}
            />
          </Field>
          <div class="flex flex-col gap-2">
            <span class="text-12-regular text-text-base">{language.t("config.permissions")}</span>
            <PermissionEditor
              model={state.form.permission}
              effective={effectivePermission()}
              onChange={(permission) => setState("form", "permission", permission)}
            />
          </div>
          <Show when={props.scope.fileCapable()}>
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.form.mirrorToFile}
                onChange={(event) => setState("form", "mirrorToFile", event.currentTarget.checked)}
              />
              <span class="text-12-regular text-text-base">{language.t("config.agents.mirrorFile")}</span>
            </label>
          </Show>
          <Show when={state.error}>
            <span class="text-12-regular text-text-danger">{state.error}</span>
          </Show>
          <SaveBar
            dirty={dirty()}
            saving={save.isPending}
            disabled={state.isNew && (!AGENT_NAME_RE.test(state.draftName.trim()) || nameTaken())}
            disabledReason={state.isNew ? language.t("config.agents.nameHint") : undefined}
            onSave={() => void save.mutate()}
            onDiscard={() => setState("form", state.baseline)}
          />
        </Show>
      </div>
    </div>
  )
}
