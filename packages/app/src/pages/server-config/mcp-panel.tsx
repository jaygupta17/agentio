// MCP servers: durable via the `mcp` config section (or direct sandbox file
// edit for deletes), live connect/disconnect via the instance API. The
// OAuth round-trip itself is v1.1 backlog; needs_auth states are surfaced.

import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { mcpConnect, mcpDisconnect, mcpStatus } from "@/server-config/api"
import type { McpConfig } from "@/server-config/types"
import { configQueryKey, useErrorText, type ConfigScope } from "./shared"
import { createGlobalWriteService, createProjectWriteService, type WriteService } from "./write-service"
import { SANDBOX_CONFIG_DIR } from "@/server-config/files"
import { ActionChip, EmptyState, Field, ReadOnlyBanner, SaveBar, SectionHeader } from "./atoms"

interface EntryForm {
  type: "local" | "remote"
  command: string
  url: string
  environment: Array<{ key: string; value: string }>
  headers: Array<{ key: string; value: string }>
  enabled: boolean
}

const emptyEntry = (): EntryForm => ({ type: "local", command: "", url: "", environment: [], headers: [], enabled: true })

function formFromConfig(config: McpConfig | { enabled: boolean } | undefined): EntryForm {
  if (!config) return emptyEntry()
  const base: EntryForm = { ...emptyEntry(), enabled: (config as { enabled?: boolean }).enabled !== false }
  if ("type" in config && config.type === "local") {
    return { ...base, type: "local", command: config.command.join("\n"), environment: kvToList(config.environment) }
  }
  if ("type" in config && config.type === "remote") {
    return { ...base, type: "remote", url: config.url, headers: kvToList(config.headers) }
  }
  return base
}

function kvToList(record: Record<string, string> | undefined) {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
}

function listToKv(list: Array<{ key: string; value: string }>): Record<string, string> | undefined {
  const out = Object.fromEntries(list.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]))
  return Object.keys(out).length ? out : undefined
}

function configFromForm(form: EntryForm): McpConfig {
  if (form.type === "local") {
    const command = form.command.split("\n").map((line) => line.trim()).filter(Boolean)
    const environment = listToKv(form.environment)
    return { type: "local", command, ...(environment ? { environment } : {}), ...(form.enabled ? {} : { enabled: false }) }
  }
  const headers = listToKv(form.headers)
  return { type: "remote", url: form.url.trim(), ...(headers ? { headers } : {}), ...(form.enabled ? {} : { enabled: false }) }
}

export function McpPanel(props: { scope: ConfigScope }) {
  const language = useLanguage()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    selected: "",
    isNew: false,
    draftName: "",
    form: emptyEntry(),
    baseline: emptyEntry(),
    raw: {} as Record<string, McpConfig | { enabled: boolean }>,
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

  const configQuery = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "mcp-source"),
    queryFn: () => writeService()?.read(),
    enabled: () => !!writeService(),
  }))

  const status = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "mcp-status"),
    queryFn: () => mcpStatus(props.scope.target()),
    enabled: () => !!props.scope.serverKey(),
  }))

  createEffect(() => {
    const doc = configQuery.data
    if (!doc) return
    const raw = (doc.mcp ?? {}) as Record<string, McpConfig | { enabled: boolean }>
    setState("raw", raw)
    if (state.selected && !state.isNew && raw[state.selected]) {
      const loaded = formFromConfig(raw[state.selected])
      if (JSON.stringify(state.form) === JSON.stringify(state.baseline)) setState("form", loaded)
      setState("baseline", loaded)
    }
  })

  const names = createMemo(() => Object.keys(state.raw).sort())
  const dirty = createMemo(() => JSON.stringify(state.form) !== JSON.stringify(state.baseline))
  const statusOf = (name: string) => status.data?.[name]

  function select(name: string) {
    setState({ selected: name, isNew: false, error: "", form: formFromConfig(state.raw[name]), baseline: formFromConfig(state.raw[name]) })
  }

  const save = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service) throw new Error("scope not writable")
      const name = state.isNew ? state.draftName.trim() : state.selected
      if (!name) throw new Error(language.t("config.mcp.nameRequired"))
      await service.setSection("mcp", { ...state.raw, [name]: configFromForm(state.form) })
      setState({ selected: name, isNew: false, baseline: state.form })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "mcp").slice(0, 2) })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const remove = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service?.removePath) throw new Error(language.t("config.deleteRequiresSandbox"))
      await service.removePath(["mcp", state.selected])
      setState({ selected: "", form: emptyEntry(), baseline: emptyEntry() })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "mcp").slice(0, 2) })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const toggleConnection = createMutation(() => ({
    mutationFn: async (input: { name: string; connect: boolean }) => {
      await (input.connect ? mcpConnect(props.scope.target(), input.name) : mcpDisconnect(props.scope.target(), input.name))
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "mcp-status") })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const KvRows = (rowProps: {
    rows: () => Array<{ key: string; value: string }>
    label: string
    onPatch: (index: number, patch: Partial<{ key: string; value: string }>) => void
    onAdd: () => void
    onRemove: (index: number) => void
  }) => (
    <div class="flex flex-col gap-2">
      <span class="text-12-regular text-text-base">{rowProps.label}</span>
      <For each={rowProps.rows()}>
        {(row, index) => (
          <div class="flex items-center gap-2">
            <TextInputV2 appearance="base" class="!w-40 min-w-0" value={row.key} placeholder="KEY" onInput={(e) => rowProps.onPatch(index(), { key: e.currentTarget.value })} />
            <TextInputV2 appearance="base" class="!w-full min-w-0 flex-1" value={row.value} type="password" onInput={(e) => rowProps.onPatch(index(), { value: e.currentTarget.value })} />
            <button type="button" class="text-text-weak hover:text-text-danger" onClick={() => rowProps.onRemove(index())} aria-label={language.t("config.remove")}>
              ×
            </button>
          </div>
        )}
      </For>
      <button type="button" class="self-start text-12-medium text-text-base hover:text-text-strong" onClick={rowProps.onAdd}>
        + {language.t("config.mcp.addRow")}
      </button>
    </div>
  )

  return (
    <div class="flex gap-6 min-w-0">
      <div class="flex flex-col gap-1 w-56 shrink-0">
        <ButtonV2 variant="neutral" class="justify-start" onClick={() => setState({ selected: "", isNew: true, draftName: "", form: emptyEntry(), baseline: emptyEntry(), error: "" })}>
          + {language.t("config.mcp.new")}
        </ButtonV2>
        <For each={names()}>
          {(name) => (
            <button
              type="button"
              onClick={() => select(name)}
              class={`flex flex-col items-start px-3 py-2 rounded-lg text-left ${
                state.selected === name && !state.isNew ? "bg-surface-raised-base" : "hover:bg-surface-raised-base-hover"
              }`}
            >
              <span class="text-12-medium text-text-strong">{name}</span>
              <span class="text-12-regular text-text-weak">{statusOf(name)?.status ?? language.t("config.mcp.untried")}</span>
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-col gap-4 min-w-0 flex-1">
        <Show when={!state.selected && !state.isNew}>
          <EmptyState text={language.t("config.mcp.pick")} />
        </Show>
        <Show when={state.selected || state.isNew}>
          <SectionHeader title={state.isNew ? language.t("config.mcp.new") : state.selected}>
            <Show when={!state.isNew}>
              <ButtonV2
                variant="neutral"
                disabled={toggleConnection.isPending || !statusOf(state.selected)}
                onClick={() => void toggleConnection.mutate({ name: state.selected, connect: statusOf(state.selected)?.status !== "connected" })}
              >
                {statusOf(state.selected)?.status === "connected" ? language.t("config.mcp.disconnect") : language.t("config.mcp.connect")}
              </ButtonV2>
            </Show>
            <Show when={!state.isNew && props.scope.fileCapable()}>
              <ButtonV2 variant="neutral" disabled={remove.isPending} onClick={() => void remove.mutate()}>
                {language.t("config.delete")}
              </ButtonV2>
            </Show>
          </SectionHeader>
          <Show when={state.selected && statusOf(state.selected)?.status === "needs_auth"}>
            <ReadOnlyBanner text={language.t("config.mcp.oauthDeferred")} />
          </Show>
          <Show when={state.isNew}>
            <Field label={language.t("config.mcp.name")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.draftName} onInput={(e) => setState("draftName", e.currentTarget.value)} />
            </Field>
          </Show>
          <div class="flex items-center gap-1.5">
            <ActionChip selected={state.form.type === "local"} onClick={() => setState("form", "type", "local")}>
              {language.t("config.mcp.local")}
            </ActionChip>
            <ActionChip selected={state.form.type === "remote"} onClick={() => setState("form", "type", "remote")}>
              {language.t("config.mcp.remote")}
            </ActionChip>
          </div>
          <Show when={state.form.type === "local"}>
            <Field label={language.t("config.mcp.command")} hint={language.t("config.mcp.commandHint")}>
              <TextareaV2 rows={3} class="w-full font-mono" value={state.form.command} onInput={(e) => setState("form", "command", e.currentTarget.value)} />
            </Field>
            <KvRows
              label={language.t("config.mcp.environment")}
              rows={() => state.form.environment}
              onPatch={(index, patch) => setState("form", "environment", index, patch)}
              onAdd={() => setState("form", "environment", (list) => [...list, { key: "", value: "" }])}
              onRemove={(index) => setState("form", "environment", (list) => list.filter((_, i) => i !== index))}
            />
          </Show>
          <Show when={state.form.type === "remote"}>
            <Field label={language.t("config.mcp.url")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.form.url} placeholder="https://…/mcp" onInput={(e) => setState("form", "url", e.currentTarget.value)} />
            </Field>
            <KvRows
              label={language.t("config.mcp.headers")}
              rows={() => state.form.headers}
              onPatch={(index, patch) => setState("form", "headers", index, patch)}
              onAdd={() => setState("form", "headers", (list) => [...list, { key: "", value: "" }])}
              onRemove={(index) => setState("form", "headers", (list) => list.filter((_, i) => i !== index))}
            />
          </Show>
          <label class="flex items-center gap-2">
            <input type="checkbox" checked={state.form.enabled} onChange={(e) => setState("form", "enabled", e.currentTarget.checked)} />
            <span class="text-12-regular text-text-base">{language.t("config.mcp.enabled")}</span>
          </label>
          <Show when={state.error}>
            <span class="text-12-regular text-text-danger">{state.error}</span>
          </Show>
          <SaveBar
            dirty={dirty()}
            saving={save.isPending}
            disabled={state.isNew && !state.draftName.trim()}
            onSave={() => void save.mutate()}
            onDiscard={() => setState("form", state.baseline)}
          />
        </Show>
      </div>
    </div>
  )
}
