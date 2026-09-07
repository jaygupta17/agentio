// Small shared UI atoms for the config page. Deliberately plain tokens
// (same classes as onboarding) instead of settings-dialog internals.

import { type JSX, Show, createMemo } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"

export function SectionHeader(props: { title: string; description?: string; children?: JSX.Element }) {
  return (
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1 min-w-0">
        <h2 class="text-14-medium text-text-strong">{props.title}</h2>
        <Show when={props.description}>
          <p class="text-12-regular text-text-weak">{props.description}</p>
        </Show>
      </div>
      <div class="flex items-center gap-2 shrink-0">{props.children}</div>
    </div>
  )
}

export function ReadOnlyBanner(props: { text: string }) {
  return (
    <div class="flex items-center gap-2 rounded-lg border border-border-weak bg-surface-base px-3 py-2">
      <span class="size-2 rounded-full bg-text-warn shrink-0" />
      <span class="text-12-regular text-text-base">{props.text}</span>
    </div>
  )
}

export function ActionChip(props: {
  selected: boolean
  disabled?: boolean
  tone?: "allow" | "ask" | "deny" | "neutral"
  onClick: () => void
  children: JSX.Element
}) {
  const toneClass = () => {
    if (!props.selected) return "text-text-weak hover:text-text-base"
    switch (props.tone) {
      case "allow":
        return "text-text-allow"
      case "ask":
        return "text-text-ask"
      case "deny":
        return "text-text-deny"
      default:
        return "text-text-strong"
    }
  }
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={() => props.onClick()}
      class={`px-2.5 py-1 rounded-md text-12-medium border transition-colors disabled:opacity-50 ${
        props.selected ? "border-border-strong bg-surface-raised-base" : "border-border-weak"
      } ${toneClass()}`}
    >
      {props.children}
    </button>
  )
}

/** Three-state (+inherit) action picker used across the config page. */
export function ActionSelect(props: {
  value: "allow" | "ask" | "deny" | null
  inherit?: boolean
  disabled?: boolean
  onChange: (value: "allow" | "ask" | "deny" | null) => void
}) {
  const language = useLanguage()
  const options = createMemo(() => [
    ...(props.inherit ? [{ value: null as "allow" | "ask" | "deny" | null, label: language.t("config.inherit") }] : []),
    { value: "allow" as const, label: language.t("config.allow") },
    { value: "ask" as const, label: language.t("config.ask") },
    { value: "deny" as const, label: language.t("config.deny") },
  ])
  return (
    <div class="flex items-center gap-1.5 flex-wrap">
      {options().map((option) => (
        <ActionChip
          selected={props.value === option.value}
          disabled={props.disabled}
          tone={option.value ?? "neutral"}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </ActionChip>
      ))}
    </div>
  )
}

export function EmptyState(props: { text: string }) {
  return <p class="text-12-regular text-text-weak py-6 text-center">{props.text}</p>
}

export function SaveBar(props: {
  dirty: boolean
  saving: boolean
  disabled?: boolean
  disabledReason?: string
  onSave: () => void
  onDiscard: () => void
}) {
  const language = useLanguage()
  return (
    <div class="flex items-center gap-2 sticky bottom-0 py-3 bg-v2-background-bg-deep">
      <Show when={props.dirty}>
        <ButtonV2 variant="neutral" disabled={props.saving} onClick={props.onDiscard}>
          {language.t("config.discard")}
        </ButtonV2>
      </Show>
      <ButtonV2 variant="contrast" disabled={!props.dirty || props.saving || props.disabled} onClick={props.onSave}>
        {props.saving ? language.t("config.saving") : language.t("config.save")}
      </ButtonV2>
      <Show when={props.disabled && props.disabledReason}>
        <span class="text-12-regular text-text-warn">{props.disabledReason}</span>
      </Show>
    </div>
  )
}

export function Field(props: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-1.5 w-full">
      <span class="text-12-regular text-text-base">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-12-regular text-text-weak">{props.hint}</span>
      </Show>
    </label>
  )
}

export function NumberField(props: {
  label: string
  value: number | undefined
  min: number
  max: number
  step: number
  placeholder: string
  disabled?: boolean
  onChange: (value: number | undefined) => void
}) {
  const language = useLanguage()
  return (
    <div class="flex flex-col gap-1.5 min-w-0">
      <div class="flex items-center justify-between gap-2">
        <span class="text-12-regular text-text-base">{props.label}</span>
        <Show when={props.value !== undefined}>
          <button
            type="button"
            class="text-12-regular text-text-weak hover:text-text-base"
            onClick={() => props.onChange(undefined)}
            aria-label={language.t("config.clear")}
          >
            ×
          </button>
        </Show>
      </div>
      <input
        type="number"
        disabled={props.disabled}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value ?? ""}
        placeholder={props.placeholder}
        onInput={(event) => {
          const raw = event.currentTarget.value
          if (raw === "") return props.onChange(undefined)
          const parsed = Number(raw)
          if (Number.isFinite(parsed)) props.onChange(parsed)
        }}
        class="w-full rounded-md border border-border-weak bg-surface-base px-2.5 py-1.5 text-14-regular text-text-strong focus:border-border-strong outline-none disabled:opacity-50"
      />
    </div>
  )
}

