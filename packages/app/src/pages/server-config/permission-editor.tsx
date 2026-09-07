// Controlled permission matrix editor over the parse/serialize model in
// src/server-config/permissions.ts. Edits SOURCE config only — resolved
// rules from GET /agent are passed in as `effective` hints and never
// written back (the classic config-corruption bug this avoids).

import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import {
  clonePermissionModel,
  PATTERN_CAPABLE_KEYS,
  type PermissionAction,
  type PermissionModel,
} from "@/server-config/permissions"
import { ActionSelect } from "./atoms"

/** Permission keys the v1.18.27 schema recognizes. */
export const KNOWN_PERMISSION_KEYS = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "external_directory",
  "todowrite",
  "question",
  "webfetch",
  "websearch",
  "lsp",
  "skill",
  "doom_loop",
] as const

export function keyLabel(raw: string) {
  return raw
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function PermissionEditor(props: {
  model: PermissionModel
  disabled?: boolean
  /** resolved (GET /agent) actions per key, display-only hints */
  effective?: Record<string, PermissionAction>
  onChange: (next: PermissionModel) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ expanded: {} as Record<string, boolean>, newKey: "" })

  const keys = createMemo(() => {
    const known = (KNOWN_PERMISSION_KEYS as readonly string[]).filter(
      (key) => key !== "doom_loop" || props.model.keys[key] !== undefined,
    )
    const custom = Object.keys(props.model.keys).filter((key) => !known.includes(key))
    return [...known, ...custom]
  })

  const mutate = (fn: (next: PermissionModel) => void) => {
    const next = clonePermissionModel(props.model)
    fn(next)
    props.onChange(next)
  }

  const setAction = (key: string, action: PermissionAction | null) =>
    mutate((next) => {
      if (action === null) {
        delete next.keys[key]
        return
      }
      const current = next.keys[key]
      if (current) current.action = action
      else next.keys[key] = { action, patterns: [] }
    })

  const setPattern = (key: string, index: number, patch: { pattern?: string; action?: PermissionAction }) =>
    mutate((next) => {
      const rule = next.keys[key]?.patterns[index]
      if (!rule) return
      if (patch.pattern !== undefined) rule.pattern = patch.pattern
      if (patch.action !== undefined) rule.action = patch.action
    })

  const addPattern = (key: string) =>
    mutate((next) => {
      const current = next.keys[key] ?? { action: null, patterns: [] }
      current.patterns.push({ pattern: "", action: "allow" })
      next.keys[key] = current
    })

  const removePattern = (key: string, index: number) =>
    mutate((next) => {
      const current = next.keys[key]
      if (!current) return
      current.patterns.splice(index, 1)
    })

  const addCustomKey = () => {
    const raw = state.newKey.trim().toLowerCase().replace(/\s+/g, "_")
    if (!raw || props.model.keys[raw]) return
    mutate((next) => {
      next.keys[raw] = { action: "ask", patterns: [] }
    })
    setState("newKey", "")
    setState("expanded", raw, true)
  }

  const patternCapable = (key: string) => PATTERN_CAPABLE_KEYS.has(key) || !!props.model.keys[key]?.patterns.length

  return (
    <div class="flex flex-col divide-y divide-border-weak rounded-lg border border-border-weak overflow-hidden">
      <div class="flex items-center justify-between gap-3 px-3 py-2.5 bg-surface-base">
          <div class="flex flex-col min-w-0">
            <span class="text-14-medium text-text-strong">{language.t("config.permission.default")}</span>
            <span class="text-12-regular text-text-weak">{language.t("config.permission.defaultHint")}</span>
          </div>
          <ActionSelect
            disabled={props.disabled}
            value={props.model.global}
            onChange={(action) => mutate((next) => (next.global = action))}
          />
      </div>
      <For each={keys()}>
        {(key) => {
          const entry = createMemo(() => props.model.keys[key])
          const expanded = createMemo(() => !!state.expanded[key])
          const effective = createMemo(() => props.effective?.[key])
          return (
            <div class="flex flex-col">
              <div class="flex items-center gap-3 px-3 py-2">
                <Show when={patternCapable(key)}>
                  <button
                    type="button"
                    class="text-text-weak hover:text-text-base p-0.5"
                    aria-label={expanded() ? language.t("config.collapse") : language.t("config.expand")}
                    onClick={() => setState("expanded", key, (value: boolean) => !value)}
                  >
                    <Icon name={expanded() ? "chevron-down" : "chevron-right"} class="size-4" />
                  </button>
                </Show>
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="text-12-medium text-text-strong">{keyLabel(key)}</span>
                  <Show when={effective() && effective() !== entry()?.action}>
                    <span class="text-12-regular text-text-weak">
                      {language.t("config.permission.effective", { action: String(effective()) })}
                    </span>
                  </Show>
                </div>
                <Show when={(entry()?.patterns.length ?? 0) > 0}>
                  <span class="text-12-regular text-text-weak">{entry()!.patterns.length}</span>
                </Show>
                <ActionSelect
                  inherit
                  disabled={props.disabled}
                  value={entry()?.action ?? null}
                  onChange={(action) => setAction(key, action)}
                />
              </div>
              <Show when={expanded() && patternCapable(key)}>
                <div class="flex flex-col gap-2 px-3 pb-3 pl-9">
                  <For each={entry()?.patterns ?? []}>
                    {(rule, index) => (
                      <div class="flex items-center gap-2">
                        <TextInputV2
                          appearance="base"
                          class="!w-48 min-w-0"
                          value={rule.pattern}
                          disabled={props.disabled}
                          placeholder={language.t("config.permission.patternPlaceholder")}
                          onInput={(event) => setPattern(key, index(), { pattern: event.currentTarget.value })}
                        />
                        <ActionSelect
                          disabled={props.disabled}
                          value={rule.action}
                          onChange={(action) => action && setPattern(key, index(), { action })}
                        />
                        <button
                          type="button"
                          disabled={props.disabled}
                          class="text-text-weak hover:text-text-danger disabled:opacity-50"
                          onClick={() => removePattern(key, index())}
                          aria-label={language.t("config.remove")}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                  <button
                    type="button"
                    disabled={props.disabled}
                    class="self-start text-12-medium text-text-base hover:text-text-strong disabled:opacity-50"
                    onClick={() => addPattern(key)}
                  >
                    {language.t("config.permission.addRule")}
                  </button>
                </div>
              </Show>
            </div>
          )
        }}
      </For>
      <div class="flex items-center gap-2 px-3 py-2.5 bg-surface-base">
        <TextInputV2
          appearance="base"
          class="!w-48 min-w-0"
          value={state.newKey}
          disabled={props.disabled}
          placeholder={language.t("config.permission.customKey")}
          onInput={(event) => setState("newKey", event.currentTarget.value)}
        />
        <button
          type="button"
          disabled={props.disabled || !state.newKey.trim()}
          class="text-12-medium text-text-base hover:text-text-strong disabled:opacity-50"
          onClick={addCustomKey}
        >
          {language.t("config.permission.addKey")}
        </button>
      </div>
    </div>
  )
}
