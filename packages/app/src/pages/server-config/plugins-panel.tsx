// Plugins: the `plugin` config array (npm specs or [spec, options]).
// Arrays REPLACE on merge-patch, so add/remove works over HTTP on every
// server. File-based plugins (.opencode/plugin/*.ts) stay read-only here.

import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { configQueryKey, useErrorText, type ConfigScope } from "./shared"
import { createGlobalWriteService, createProjectWriteService, type WriteService } from "./write-service"
import { SANDBOX_CONFIG_DIR } from "@/server-config/files"
import { EmptyState, Field, SectionHeader } from "./atoms"

interface PluginEntry {
  id: string
  spec: string
  optionsText: string
}

function toEntry(index: number, item: string | [string, Record<string, unknown>]): PluginEntry {
  if (typeof item === "string") return { id: String(index), spec: item, optionsText: "" }
  const [spec, options] = item
  return { id: String(index), spec, optionsText: Object.keys(options ?? {}).length ? JSON.stringify(options, null, 2) : "" }
}

function fromEntry(entry: PluginEntry): string | [string, Record<string, unknown>] {
  const text = entry.optionsText.trim()
  if (!text) return entry.spec.trim()
  return [entry.spec.trim(), JSON.parse(text) as Record<string, unknown>]
}

export function PluginsPanel(props: { scope: ConfigScope }) {
  const language = useLanguage()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    entries: [] as PluginEntry[],
    baseline: [] as PluginEntry[],
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
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "plugins"),
    queryFn: () => writeService()?.read(),
    enabled: () => !!writeService(),
  }))

  createEffect(() => {
    const doc = configQuery.data
    if (!doc) return
    const entries = (doc.plugin ?? []).map((item, index) => toEntry(index, item))
    setState({ entries, baseline: entries.map((entry) => ({ ...entry })) })
  })

  const save = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service) throw new Error("scope not writable")
      const value = state.entries.filter((entry) => entry.spec.trim()).map(fromEntry)
      await service.setSection("plugin", value)
      setState("baseline", state.entries.map((entry) => ({ ...entry })))
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "plugins") })
    },
    onError: (err) => setState("error", err instanceof SyntaxError ? language.t("config.plugins.invalidJson") : errorText(err)),
  }))

  const dirty = createMemo(() => JSON.stringify(state.entries) !== JSON.stringify(state.baseline))

  return (
    <div class="flex flex-col gap-4 min-w-0">
      <SectionHeader title={language.t("config.plugins")} description={language.t("config.pluginsHint")}>
        <ButtonV2
          variant="neutral"
          onClick={() => setState("entries", (entries) => [...entries, { id: `new-${entries.length}`, spec: "", optionsText: "" }])}
        >
          + {language.t("config.plugins.add")}
        </ButtonV2>
      </SectionHeader>
      <Show when={!state.entries.length}>
        <EmptyState text={language.t("config.plugins.empty")} />
      </Show>
      <For each={state.entries}>
        {(entry, index) => (
          <div class="flex flex-col gap-2 rounded-lg border border-border-weak bg-surface-base p-3">
            <div class="flex items-center gap-2">
              <TextInputV2
                appearance="base"
                class="!w-full min-w-0 flex-1 font-mono"
                value={entry.spec}
                placeholder="opencode-morph@latest"
                onInput={(e) => setState("entries", index(), "spec", e.currentTarget.value)}
              />
              <button
                type="button"
                class="text-text-weak hover:text-text-danger"
                aria-label={language.t("config.remove")}
                onClick={() => setState("entries", (entries) => entries.filter((_, i) => i !== index()))}
              >
                ×
              </button>
            </div>
            <Field label={language.t("config.plugins.options")}>
              <TextareaV2
                rows={3}
                class="w-full font-mono"
                value={entry.optionsText}
                placeholder='{ "key": "value" }'
                onInput={(e) => setState("entries", index(), "optionsText", e.currentTarget.value)}
              />
            </Field>
          </div>
        )}
      </For>
      <Show when={state.error}>
        <span class="text-12-regular text-text-danger">{state.error}</span>
      </Show>
      <div class="flex items-center gap-2 sticky bottom-0 py-3">
        <ButtonV2 variant="contrast" disabled={!dirty() || save.isPending} onClick={() => void save.mutate()}>
          {save.isPending ? language.t("config.saving") : language.t("config.save")}
        </ButtonV2>
        <Show when={dirty()}>
          <ButtonV2 variant="neutral" disabled={save.isPending} onClick={() => setState("entries", state.baseline.map((entry) => ({ ...entry })))}>
            {language.t("config.discard")}
          </ButtonV2>
        </Show>
      </div>
    </div>
  )
}
