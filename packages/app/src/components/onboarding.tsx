// agentio first-run screen: shown when nothing has ever been connected.
// Two paths, one destination — a registered server (the ServerProvider
// store flips to non-empty and the app takes over reactively).
// Ported from the agentio web PWA's Onboarding wizard + connect card.
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Icon } from "@opencode-ai/ui/icon"
import { type Component, Show, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { createE2BProvider } from "@/e2b/cloud"
import { classifyError, type UserError } from "@/e2b/errors"
import {
  bootEnvs,
  connectServe,
  createAndBoot,
  DEFAULT_TEMPLATE,
  EXPECTED_OPENCODE_VERSION,
  parseKeys,
} from "@/e2b/provision"
import { generatePassword, updateVault } from "@/e2b/vault"

type Mode = "choice" | "cloud" | "remote"

export const OnboardingScreen: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const controller = new AbortController()
  onCleanup(() => controller.abort())

  const [store, setStore] = createStore({
    mode: "choice" as Mode,
    cloudStep: 0,
    e2bKey: "",
    password: "",
    keysText: "",
    busy: false,
    progress: "",
    error: null as UserError | null,
    url: "",
    username: "",
    displayName: "",
    doneSandbox: "",
    versionWarning: false,
  })

  // Once a server exists the gate swaps this screen out; stop polling work.
  createEffect(() => {
    if (server.savedCount() > 0) controller.abort()
  })

  async function connected(url: string) {
    const key = ServerConnection.Key.make(url)
    await platform.setDefaultServer?.(key)
  }

  async function launch() {
    setStore({ error: null, busy: true, progress: language.t("settings.e2b.progress.creating") })
    try {
      const provider = createE2BProvider(store.e2bKey.trim())
      const llmKeys = parseKeys(store.keysText)
      const result = await createAndBoot({
        provider,
        template: DEFAULT_TEMPLATE,
        timeoutMs: 30 * 60_000,
        envs: bootEnvs({ devicePassword: store.password, llmKeys, corsOrigins: [window.location.origin] }),
        onProgress: (step) =>
          setStore("progress", language.t(`settings.e2b.progress.${step}` as "settings.e2b.progress.creating")),
        signal: controller.signal,
      })
      // First-run setup always remembers on this device (encrypted vault).
      const persist = () =>
        updateVault((v) => ({ ...v, password: store.password, e2bKey: store.e2bKey.trim(), llmKeys }))
      const connect = await connectServe({
        server,
        url: result.url,
        username: "opencode",
        password: store.password,
        persistSecrets: persist,
        fetch: globalThis.fetch,
      })
      if (!connect.ok) {
        setStore({ error: connect.error ?? { key: "e2b.error.unreachable" }, busy: false, progress: "" })
        return
      }
      await connected(result.url)
      setStore({
        cloudStep: 3,
        busy: false,
        progress: "",
        doneSandbox: result.sandbox.id,
        versionWarning: !!connect.version && connect.version !== EXPECTED_OPENCODE_VERSION,
      })
    } catch (err) {
      setStore({ error: classifyError(err), busy: false, progress: "" })
    }
  }

  async function remoteConnect() {
    setStore({ error: null, busy: true })
    const result = await connectServe({
      server,
      url: store.url,
      ...(store.username ? { username: store.username } : {}),
      password: store.password || undefined,
      ...(store.displayName.trim() ? { displayName: store.displayName.trim() } : {}),
      fetch: globalThis.fetch,
    })
    if (!result.ok) {
      setStore({ error: result.error ?? { key: "e2b.error.unreachable" }, busy: false })
      return
    }
    const normalized = store.url.trim().replace(/\/+$/, "")
    await connected(normalized)
    setStore({ busy: false, versionWarning: !!result.version && result.version !== EXPECTED_OPENCODE_VERSION })
  }

  const stepLabel = () => {
    const steps = ["onboarding.step.keys", "onboarding.step.modelKeys", "onboarding.step.launch", "onboarding.step.done"] as const
    return language.t(steps[Math.min(store.cloudStep, 3)])
  }

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base p-6 overflow-y-auto">
      <div class="flex flex-col items-center w-full max-w-md gap-6 py-8">
        <div class="flex flex-col items-center gap-3 text-center">
          <Icon name="terminal" class="size-10 text-text-strong" />
          <h1 class="text-18-semibold text-text-strong">{language.t("onboarding.title")}</h1>
          <p class="text-14-regular text-text-base">{language.t("onboarding.subtitle")}</p>
        </div>

        <Show when={store.mode === "choice"}>
          <div class="flex flex-col gap-3 w-full">
            <button
              type="button"
              class="flex flex-col items-start gap-1 w-full text-left rounded-xl border border-border-weak bg-surface-base p-4 hover:bg-surface-raised-base-hover transition-colors"
              onClick={() => {
                setStore({ mode: "cloud", cloudStep: 0, error: null })
                if (!store.password) setStore("password", generatePassword())
              }}
            >
              <span class="text-14-medium text-text-strong">{language.t("onboarding.choice.cloud")}</span>
              <span class="text-12-regular text-text-weak">{language.t("onboarding.choice.cloudDescription")}</span>
            </button>
            <button
              type="button"
              class="flex flex-col items-start gap-1 w-full text-left rounded-xl border border-border-weak bg-surface-base p-4 hover:bg-surface-raised-base-hover transition-colors"
              onClick={() => setStore({ mode: "remote", error: null })}
            >
              <span class="text-14-medium text-text-strong">{language.t("onboarding.choice.remote")}</span>
              <span class="text-12-regular text-text-weak">{language.t("onboarding.choice.remoteDescription")}</span>
            </button>
          </div>
        </Show>

        <Show when={store.mode === "cloud"}>
          <div class="flex flex-col gap-4 w-full bg-surface-base rounded-xl border border-border-weak p-4">
            <span class="text-12-regular text-text-weak">{stepLabel()}</span>

            <Show when={store.cloudStep === 0}>
              <div class="flex flex-col gap-2">
                <label class="text-12-regular text-text-base">{language.t("settings.e2b.key")}</label>
                <TextInputV2
                  type="password"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={store.e2bKey}
                  placeholder="e2b_…"
                  autocomplete="off"
                  onInput={(event) => setStore("e2bKey", event.currentTarget.value)}
                />
                <label class="text-12-regular text-text-base mt-2">{language.t("dialog.server.add.password")}</label>
                <div class="flex gap-2">
                  <TextInputV2
                    type="password"
                    appearance="large"
                    class="!w-full min-w-0 flex-1"
                    value={store.password}
                    autocomplete="off"
                    onInput={(event) => setStore("password", event.currentTarget.value)}
                  />
                  <ButtonV2 variant="neutral" onClick={() => setStore("password", generatePassword())}>
                    {language.t("settings.e2b.generate")}
                  </ButtonV2>
                </div>
                <p class="text-12-regular text-text-weak mt-1">{language.t("onboarding.cloud.billingNote")}</p>
              </div>
            </Show>

            <Show when={store.cloudStep === 1}>
              <div class="flex flex-col gap-2">
                <label class="text-12-regular text-text-base">{language.t("settings.e2b.keys")}</label>
                <TextInputV2
                  type="text"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={store.keysText}
                  placeholder={language.t("settings.e2b.keysPlaceholder")}
                  onInput={(event) => setStore("keysText", event.currentTarget.value)}
                />
              </div>
            </Show>

            <Show when={store.cloudStep === 2}>
              <div class="flex flex-col gap-2">
                <p class="text-14-regular text-text-base">{language.t("onboarding.cloud.launchNote")}</p>
                <Show when={store.progress}>
                  <span class="text-12-regular text-text-weak">{store.progress}</span>
                </Show>
              </div>
            </Show>

            <Show when={store.cloudStep === 3}>
              <div class="flex flex-col gap-2">
                <p class="text-14-regular text-text-base">
                  {language.t("onboarding.cloud.done", { sandbox: store.doneSandbox.slice(0, 12) })}
                </p>
                <Show when={store.versionWarning}>
                  <span class="text-12-regular text-text-warn">{language.t("settings.e2b.versionMismatch")}</span>
                </Show>
              </div>
            </Show>

            <Show when={store.error}>
              {(error) => <span class="text-12-regular text-text-danger">{language.t(error().key, error().params ?? {})}</span>}
            </Show>

            <div class="flex justify-between gap-2 w-full">
              <ButtonV2 variant="neutral" disabled={store.busy} onClick={() => setStore({ mode: "choice", error: null })}>
                {language.t("onboarding.change")}
              </ButtonV2>
              <Show when={store.cloudStep === 0}>
                <ButtonV2 variant="contrast" disabled={!store.e2bKey.trim() || !store.password} onClick={() => setStore("cloudStep", 1)}>
                  {language.t("onboarding.continue")}
                </ButtonV2>
              </Show>
              <Show when={store.cloudStep === 1}>
                <div class="flex gap-2">
                  <ButtonV2 variant="neutral" onClick={() => setStore("cloudStep", 0)}>
                    {language.t("onboarding.back")}
                  </ButtonV2>
                  <ButtonV2 variant="contrast" onClick={() => setStore("cloudStep", 2)}>
                    {language.t("onboarding.launch")}
                  </ButtonV2>
                </div>
              </Show>
              <Show when={store.cloudStep === 2}>
                <ButtonV2 variant="contrast" disabled={store.busy} onClick={launch}>
                  {store.busy ? language.t("onboarding.launching") : language.t("onboarding.launch")}
                </ButtonV2>
              </Show>
              <Show when={store.cloudStep === 3}>
                <span class="text-14-regular text-text-weak self-center">{language.t("onboarding.waiting")}</span>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={store.mode === "remote"}>
          <div class="flex flex-col gap-3 w-full bg-surface-base rounded-xl border border-border-weak p-4">
            <div class="flex flex-col gap-2">
              <label class="text-12-regular text-text-base">{language.t("onboarding.remote.url")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.url}
                placeholder="https://abc123-4096.e2b.dev  /  http://192.168.0.10:4096"
                autocomplete="off"
                onInput={(event) => setStore("url", event.currentTarget.value)}
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div class="flex flex-col gap-2">
                <label class="text-12-regular text-text-base">{language.t("onboarding.remote.username")}</label>
                <TextInputV2
                  type="text"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={store.username}
                  placeholder="opencode"
                  autocomplete="off"
                  onInput={(event) => setStore("username", event.currentTarget.value)}
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-12-regular text-text-base">{language.t("dialog.server.add.password")}</label>
                <TextInputV2
                  type="password"
                  appearance="large"
                  class="!w-full self-stretch"
                  value={store.password}
                  autocomplete="off"
                  onInput={(event) => setStore("password", event.currentTarget.value)}
                />
              </div>
            </div>
            <p class="text-12-regular text-text-weak">{language.t("onboarding.remote.hint")}</p>
            <Show when={store.error}>
              {(error) => <span class="text-12-regular text-text-danger">{language.t(error().key, error().params ?? {})}</span>}
            </Show>
            <div class="flex justify-between gap-2 w-full">
              <ButtonV2 variant="neutral" disabled={store.busy} onClick={() => setStore({ mode: "choice", error: null })}>
                {language.t("onboarding.change")}
              </ButtonV2>
              <ButtonV2 variant="contrast" disabled={store.busy || !store.url.trim()} onClick={remoteConnect}>
                {store.busy ? language.t("onboarding.connecting") : language.t("onboarding.remote.connect")}
              </ButtonV2>
            </div>
          </div>
        </Show>
      </div>
    </div>
  )
}
