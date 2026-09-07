// Slash commands via the `command` config-key map (inline templates work on
// every server; deletion needs the E2B file path).

import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery, useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { listCommands } from "@/server-config/api"
import { configQueryKey, useErrorText, type ConfigScope } from "./shared"
import { createGlobalWriteService, createProjectWriteService, type WriteService } from "./write-service"
import { SANDBOX_CONFIG_DIR } from "@/server-config/files"
import { EmptyState, Field, ReadOnlyBanner, SaveBar, SectionHeader } from "./atoms"
import { createMutation } from "@tanstack/solid-query"

const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

interface CommandForm {
  description: string
  agent: string
  model: string
  subtask: boolean
  template: string
}

const emptyForm = (): CommandForm => ({ description: "", agent: "", model: "", subtask: false, template: "" })

export function CommandsPanel(props: { scope: ConfigScope }) {
  const language = useLanguage()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    selected: "",
    isNew: false,
    draftName: "",
    form: emptyForm(),
    baseline: emptyForm(),
    source: {} as Record<string, CommandForm>,
    raw: {} as Record<string, unknown>,
    error: "",
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

  const commands = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "commands"),
    queryFn: () => listCommands(props.scope.target()),
    enabled: () => !!props.scope.serverKey(),
  }))

  const configQuery = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "commands-source"),
    queryFn: () => writeService()?.read(),
    enabled: () => !!writeService(),
  }))

  const toForm = (input: { description?: string; agent?: string; model?: string; subtask?: boolean; template?: string }): CommandForm => ({
    description: input.description ?? "",
    agent: input.agent ?? "",
    model: input.model ?? "",
    subtask: !!input.subtask,
    template: input.template ?? "",
  })

  createEffect(() => {
    const doc = configQuery.data
    if (!doc) return
    const source: Record<string, CommandForm> = {}
    const raw: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(doc.command ?? {})) {
      source[name] = toForm(value)
      raw[name] = value
    }
    setState({ source, raw })
    if (state.selected && !state.isNew && source[state.selected]) {
      const loaded = source[state.selected]
      if (JSON.stringify(state.form) === JSON.stringify(state.baseline)) setState("form", loaded)
      setState("baseline", loaded)
    }
  })

  const visible = createMemo(() =>
    (commands.data ?? []).filter((c) => c.source !== "skill").sort((a, b) => a.name.localeCompare(b.name)),
  )

  function select(name: string) {
    const entry = state.source[name] ?? toForm(visible().find((c) => c.name === name) ?? {})
    setState({ selected: name, isNew: false, form: entry, baseline: { ...entry }, error: "" })
  }

  const save = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service) throw new Error("scope not writable")
      const name = state.isNew ? state.draftName.trim() : state.selected
      if (!COMMAND_NAME_RE.test(name)) throw new Error(language.t("config.commands.invalidName"))
      const value: Record<string, unknown> = {}
      if (state.form.description.trim()) value.description = state.form.description.trim()
      if (state.form.agent.trim()) value.agent = state.form.agent.trim()
      if (state.form.model.trim()) value.model = state.form.model.trim()
      if (state.form.subtask) value.subtask = true
      if (state.form.template.trim()) value.template = state.form.template
      await service.setSection("command", { ...state.raw, [name]: value })
      setState({ selected: name, isNew: false, baseline: state.form })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "commands").slice(0, 2) })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const remove = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service?.removePath) throw new Error(language.t("config.deleteRequiresSandbox"))
      await service.removePath(["command", state.selected])
      setState({ selected: "", form: emptyForm(), baseline: emptyForm() })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "commands").slice(0, 2) })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const dirty = createMemo(() => JSON.stringify(state.form) !== JSON.stringify(state.baseline))

  return (
    <div class="flex gap-6 min-w-0">
      <div class="flex flex-col gap-1 w-56 shrink-0">
        <ButtonV2 variant="neutral" class="justify-start" onClick={() => setState({ selected: "", isNew: true, draftName: "", form: emptyForm(), baseline: emptyForm(), error: "" })}>
          + {language.t("config.commands.new")}
        </ButtonV2>
        <For each={visible()}>
          {(command) => (
            <button
              type="button"
              onClick={() => select(command.name)}
              class={`flex flex-col items-start px-3 py-2 rounded-lg text-left ${
                state.selected === command.name && !state.isNew ? "bg-surface-raised-base" : "hover:bg-surface-raised-base-hover"
              }`}
            >
              <span class="text-12-medium text-text-strong">/{command.name}</span>
              <Show when={command.description}>
                <span class="text-12-regular text-text-weak truncate w-full">{command.description}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-col gap-4 min-w-0 flex-1">
        <Show when={!state.selected && !state.isNew}>
          <EmptyState text={language.t("config.commands.pick")} />
        </Show>
        <Show when={state.selected || state.isNew}>
          <SectionHeader title={state.isNew ? language.t("config.commands.new") : `/${state.selected}`}>
            <Show when={!state.isNew && props.scope.fileCapable()}>
              <ButtonV2 variant="neutral" disabled={remove.isPending} onClick={() => void remove.mutate()}>
                {language.t("config.delete")}
              </ButtonV2>
            </Show>
          </SectionHeader>
          <Show when={!props.scope.fileCapable()}>
            <ReadOnlyBanner text={language.t("config.commands.remoteHint")} />
          </Show>
          <Show when={state.isNew}>
            <Field label={language.t("config.commands.name")} hint={language.t("config.commands.nameHint")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.draftName} onInput={(e) => setState("draftName", e.currentTarget.value)} />
            </Field>
          </Show>
          <Field label={language.t("config.commands.description")}>
            <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.description} onInput={(e) => setState("form", "description", e.currentTarget.value)} />
          </Field>
          <div class="grid grid-cols-2 gap-4">
            <Field label={language.t("config.commands.agent")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.agent} onInput={(e) => setState("form", "agent", e.currentTarget.value)} />
            </Field>
            <Field label={language.t("config.agents.model")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.model} onInput={(e) => setState("form", "model", e.currentTarget.value)} />
            </Field>
          </div>
          <label class="flex items-center gap-2">
            <input type="checkbox" checked={state.form.subtask} onChange={(e) => setState("form", "subtask", e.currentTarget.checked)} />
            <span class="text-12-regular text-text-base">{language.t("config.commands.subtask")}</span>
          </label>
          <Field label={language.t("config.commands.template")} hint={language.t("config.commands.templateHint")}>
            <TextareaV2 rows={8} class="w-full font-mono" value={state.form.template} onInput={(e) => setState("form", "template", e.currentTarget.value)} />
          </Field>
          <Show when={state.error}>
            <span class="text-12-regular text-text-danger">{state.error}</span>
          </Show>
          <SaveBar
            dirty={dirty()}
            saving={save.isPending}
            disabled={state.isNew && !COMMAND_NAME_RE.test(state.draftName.trim())}
            onSave={() => void save.mutate()}
            onDiscard={() => setState("form", state.baseline)}
          />
        </Show>
      </div>
    </div>
  )
}
