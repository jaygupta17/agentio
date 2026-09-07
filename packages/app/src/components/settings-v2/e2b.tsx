// agentio launcher — E2B sandbox management tab (Settings → Cloud).
// Solid port of `app/web` SandboxPanel + KeysPanel over the `src/e2b` seam;
// shared provisioning logic lives in provision.ts (also used by first-run
// onboarding). E2B runs headless `opencode serve v1.18.27`; this page is
// only the launcher.
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { createE2BProvider, waitForServeVersion, type CloudSandbox } from "@/e2b/cloud"
import {
  bootEnvs,
  connectServe,
  createAndBoot,
  DEFAULT_TEMPLATE,
  EXPECTED_OPENCODE_VERSION,
  parseKeys,
  SERVE_PORT,
} from "@/e2b/provision"
import { classifyError, type UserError } from "@/e2b/errors"
import { clearVault, generatePassword, loadVault, updateVault } from "@/e2b/vault"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

export const SettingsE2BV2: Component = () => {
  const language = useLanguage()
  const server = useServer()
  const [store, setStore] = createStore({
    e2bKey: "",
    password: "",
    keysText: "",
    template: DEFAULT_TEMPLATE,
    timeoutMin: "30",
    remember: false,
    sandboxes: [] as CloudSandbox[],
    picked: "",
    busy: false,
    error: null as UserError | null,
    progress: "",
    lastUrl: "",
    versionWarning: "",
  })

  const controller = new AbortController()
  onCleanup(() => controller.abort())

  onMount(() => {
    loadVault()
      .then((v) => {
        if (!v) return
        setStore({
          e2bKey: v.e2bKey,
          password: v.password,
          keysText: Object.entries(v.llmKeys)
            .map(([p, k]) => `${p}=${k}`)
            .join("\n"),
          remember: !!(v.e2bKey || v.password || Object.keys(v.llmKeys).length > 0),
        })
      })
      .catch(() => setStore("error", { key: "e2b.error.raw", params: { message: "Vault unavailable on this browser." } }))
  })

  function provider() {
    if (!store.e2bKey.trim()) throw new Error(language.t("settings.e2b.keyRequired"))
    return createE2BProvider(store.e2bKey.trim())
  }

  function envs() {
    return bootEnvs({
      devicePassword: store.password,
      llmKeys: parseKeys(store.keysText),
      corsOrigins: [window.location.origin],
    })
  }

  // Merge into the vault so per-server credentials survive alongside the
  // form's device secrets.
  async function persist() {
    if (!store.remember) return
    await updateVault((v) => ({
      ...v,
      password: store.password || v.password,
      e2bKey: store.e2bKey.trim() || v.e2bKey,
      llmKeys: parseKeys(store.keysText),
    }))
  }

  async function connect(url: string) {
    const result = await connectServe({
      server,
      url,
      username: "opencode",
      password: store.password,
      persistSecrets: persist,
      fetch: globalThis.fetch,
    })
    if (!result.ok) {
      setStore("error", result.error ?? { key: "e2b.error.unreachable" })
      return false
    }
    setStore({
      versionWarning: result.version && result.version !== EXPECTED_OPENCODE_VERSION ? result.version : "",
      lastUrl: url,
    })
    return true
  }

  async function list() {
    setStore({ error: null, busy: true })
    try {
      const all = await provider().listSandboxes()
      setStore({ sandboxes: all, picked: all.some((s) => s.id === store.picked) ? store.picked : (all[0]?.id ?? "") })
    } catch (err) {
      setStore("error", classifyError(err))
    } finally {
      setStore("busy", false)
    }
  }

  async function useSelected() {
    const meta = store.sandboxes.find((s) => s.id === store.picked)
    if (!meta) return
    if (!store.password) {
      setStore("error", { key: "settings.e2b.passwordRequired" })
      return
    }
    setStore({ error: null, busy: true })
    try {
      const url = await provider().getServeUrl(meta.id, SERVE_PORT)
      await connect(url)
    } catch (err) {
      setStore("error", classifyError(err))
    } finally {
      setStore("busy", false)
    }
  }

  // FS-only pause kills the serve process. Waking = connect (Sandbox.connect
  // auto-resumes) then re-run boot.sh with vault envs, then wait for health.
  async function wake() {
    const meta = store.sandboxes.find((s) => s.id === store.picked)
    if (!meta || !store.password) {
      if (!store.password) setStore("error", { key: "settings.e2b.passwordRequired" })
      return
    }
    setStore({ error: null, busy: true, progress: language.t("settings.e2b.progress.starting") })
    try {
      const p = provider()
      const url = await p.getServeUrl(meta.id, SERVE_PORT)
      await p.startServe(meta.id, envs())
      await waitForServeVersion(url, { signal: controller.signal })
      setStore("progress", "")
      await connect(url)
      await list()
    } catch (err) {
      setStore({ error: classifyError(err), progress: "" })
    } finally {
      setStore("busy", false)
    }
  }

  async function restartServe() {
    const meta = store.sandboxes.find((s) => s.id === store.picked)
    if (!meta || !store.password) return
    setStore({ error: null, busy: true, progress: language.t("settings.e2b.progress.starting") })
    try {
      const p = provider()
      await p.startServe(meta.id, envs())
      const url = await p.getServeUrl(meta.id, SERVE_PORT)
      setStore("progress", language.t("settings.e2b.progress.waiting"))
      await waitForServeVersion(url, { signal: controller.signal })
      setStore("progress", "")
      await connect(url)
    } catch (err) {
      setStore({ error: classifyError(err), progress: "" })
    } finally {
      setStore("busy", false)
    }
  }

  async function create() {
    if (!store.password) {
      setStore("error", { key: "settings.e2b.passwordRequired" })
      return
    }
    setStore({ error: null, busy: true, progress: language.t("settings.e2b.progress.creating") })
    try {
      const result = await createAndBoot({
        provider: provider(),
        template: store.template.trim() || DEFAULT_TEMPLATE,
        timeoutMs: Number(store.timeoutMin) * 60_000,
        envs: envs(),
        onProgress: (step) =>
          setStore("progress", language.t(`settings.e2b.progress.${step}` as "settings.e2b.progress.creating")),
        signal: controller.signal,
      })
      setStore({ progress: "", sandboxes: [result.sandbox, ...store.sandboxes.filter((s) => s.id !== result.sandbox.id)], picked: result.sandbox.id })
      await connect(result.url)
    } catch (err) {
      setStore({ error: classifyError(err), progress: "" })
    } finally {
      setStore("busy", false)
    }
  }

  async function pause(id: string) {
    setStore({ error: null, busy: true })
    try {
      await provider().pauseSandbox(id)
      await list()
    } catch (err) {
      setStore("error", classifyError(err))
    } finally {
      setStore("busy", false)
    }
  }

  async function forget() {
    setStore({ e2bKey: "", password: "", keysText: "", remember: false })
    await clearVault().catch(() => {})
  }

  const pickedMeta = () => store.sandboxes.find((s) => s.id === store.picked)

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.e2b.title")}</h2>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <SettingsListV2>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("settings.e2b.key")}</label>
            <TextInputV2
              type="password"
              appearance="large"
              class="!w-full self-stretch"
              value={store.e2bKey}
              placeholder="e2b_…"
              disabled={store.busy}
              onInput={(event) => setStore("e2bKey", event.currentTarget.value)}
            />
          </div>
          <div class="grid w-full min-w-0 grid-cols-2 gap-4">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.server.add.password")}</label>
              <TextInputV2
                type="password"
                appearance="large"
                class="!w-full self-stretch"
                value={store.password}
                disabled={store.busy}
                onInput={(event) => setStore("password", event.currentTarget.value)}
              />
            </div>
            <div class="flex min-w-0 flex-col justify-end gap-2">
              <ButtonV2 variant="neutral" disabled={store.busy} onClick={() => setStore("password", generatePassword())}>
                {language.t("settings.e2b.generate")}
              </ButtonV2>
            </div>
          </div>
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("settings.e2b.keys")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={store.keysText}
              placeholder={language.t("settings.e2b.keysPlaceholder")}
              disabled={store.busy}
              onInput={(event) => setStore("keysText", event.currentTarget.value)}
            />
          </div>
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              checked={store.remember}
              onChange={(event) => setStore("remember", event.currentTarget.checked)}
            />
            <span>{language.t("settings.e2b.remember")}</span>
          </label>
          <div class="flex flex-wrap gap-2">
            <ButtonV2 variant="neutral" disabled={store.busy || !store.e2bKey.trim()} onClick={list}>
              {language.t("settings.e2b.list")}
            </ButtonV2>
            <ButtonV2
              variant="contrast"
              disabled={store.busy || !store.picked || pickedMeta()?.state !== "running"}
              onClick={useSelected}
            >
              {language.t("settings.e2b.use")}
            </ButtonV2>
            <Show when={pickedMeta()?.state === "running"}>
              <ButtonV2 variant="neutral" disabled={store.busy} onClick={restartServe}>
                {language.t("settings.e2b.restartServe")}
              </ButtonV2>
            </Show>
            <Show when={pickedMeta() && pickedMeta()?.state !== "running"}>
              <ButtonV2 variant="contrast" disabled={store.busy} onClick={wake}>
                {language.t("settings.e2b.wake")}
              </ButtonV2>
            </Show>
            <Show when={store.remember || store.e2bKey || store.password}>
              <ButtonV2 variant="neutral" disabled={store.busy} onClick={forget}>
                {language.t("settings.e2b.forget")}
              </ButtonV2>
            </Show>
          </div>
          <Show when={store.sandboxes.length > 0}>
            <For each={store.sandboxes}>
              {(s) => (
                <div class="settings-v2-servers-row">
                  <div class="settings-v2-servers-lead">
                    <div class="settings-v2-servers-copy">
                      <span class="settings-v2-servers-name">{s.id.slice(0, 12)}…</span>
                      <span class="settings-v2-servers-meta">
                        {s.state} • {s.templateId}
                      </span>
                    </div>
                  </div>
                  <div class="settings-v2-servers-actions">
                    <input
                      type="radio"
                      name="e2b-sandbox"
                      checked={store.picked === s.id}
                      onChange={() => setStore("picked", s.id)}
                      aria-label={s.id}
                    />
                    <Show when={s.state === "running"}>
                      <ButtonV2 variant="neutral" disabled={store.busy} onClick={() => pause(s.id)}>
                        {language.t("settings.e2b.pause")}
                      </ButtonV2>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
          <div class="grid w-full min-w-0 grid-cols-2 gap-4">
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("settings.e2b.template")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.template}
                disabled={store.busy}
                onInput={(event) => setStore("template", event.currentTarget.value)}
              />
            </div>
            <div class="flex min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("settings.e2b.timeout")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={store.timeoutMin}
                disabled={store.busy}
                onInput={(event) => setStore("timeoutMin", event.currentTarget.value)}
              />
            </div>
          </div>
          <ButtonV2 variant="contrast" disabled={store.busy || !store.e2bKey.trim() || !store.template.trim()} onClick={create}>
            {language.t("settings.e2b.create")}
          </ButtonV2>
          <Show when={store.progress}>
            <span class="settings-v2-servers-meta">{store.progress}</span>
          </Show>
          <Show when={store.versionWarning}>
            <span class="settings-v2-servers-meta">
              {language.t("settings.e2b.versionMismatch")}: {store.versionWarning}
            </span>
          </Show>
          <Show when={store.lastUrl}>
            <a href={store.lastUrl} target="_blank" rel="noreferrer">
              {language.t("settings.e2b.openOfficial")}
            </a>
          </Show>
          <Show when={store.error}>
            {(error) => <span class="settings-v2-server-dialog-error">{language.t(error().key, error().params ?? {})}</span>}
          </Show>
        </SettingsListV2>
      </div>
    </>
  )
}
