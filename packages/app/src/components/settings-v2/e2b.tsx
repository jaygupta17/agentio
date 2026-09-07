// agentio launcher — E2B sandbox management tab (Settings → Cloud).
// Solid port of `app/web` SandboxPanel + KeysPanel: list/pick/create/boot +
// pause/resume over the `src/e2b` seam, then registers the serve URL with the
// existing ServerConnection store (no new server plumbing). E2B runs headless
// `opencode serve v1.18.27`; this page is only the launcher.
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, For, Show, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { checkServerHealth } from "@/utils/server-health"
import { createE2BProvider, waitForServeVersion, type CloudSandbox } from "@/e2b/cloud"
import { buildAuthContent, clearVault, generatePassword, loadVault, saveVault } from "@/e2b/vault"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

export const EXPECTED_OPENCODE_VERSION = "1.18.27"
export const DEFAULT_TEMPLATE = "agentio-opencode-v1"

function parseKeys(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const provider = trimmed.slice(0, eq).trim()
    const key = trimmed.slice(eq + 1).trim()
    if (provider && key) out[provider] = key
  }
  return out
}

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
    error: "",
    progress: "",
    lastUrl: "",
    versionWarning: "",
  })

  onMount(() => {
    loadVault()
      .then((v) => {
        if (v && (v.password || v.e2bKey || Object.keys(v.llmKeys).length > 0)) {
          setStore({
            e2bKey: v.e2bKey,
            password: v.password,
            keysText: Object.entries(v.llmKeys)
              .map(([p, k]) => `${p}=${k}`)
              .join("\n"),
            remember: true,
          })
        }
      })
      .catch(() => {})
  })

  function provider() {
    if (!store.e2bKey.trim()) throw new Error(language.t("settings.e2b.keyRequired"))
    return createE2BProvider(store.e2bKey.trim())
  }

  function envs(): Record<string, string> {
    return {
      OPENCODE_SERVER_PASSWORD: store.password,
      OPENCODE_AUTH_CONTENT: buildAuthContent(parseKeys(store.keysText)),
      AGENTIO_CORS_ORIGINS: window.location.origin,
    }
  }

  async function persist() {
    if (!store.remember) return
    try {
      await saveVault({ password: store.password, e2bKey: store.e2bKey.trim(), llmKeys: parseKeys(store.keysText) })
    } catch {}
  }

  async function connect(url: string) {
    const conn = { type: "http" as const, http: { url, username: "opencode", password: store.password } }
    const health = await checkServerHealth(conn.http, globalThis.fetch)
    if (!health.healthy) {
      setStore("error", language.t("dialog.server.add.error"))
      return
    }
    setStore("versionWarning", health.version && health.version !== EXPECTED_OPENCODE_VERSION ? `${health.version}` : "")
    setStore("lastUrl", url)
    server.add(conn)
    void persist()
  }

  async function list() {
    setStore({ error: "", busy: true })
    try {
      const all = await provider().listSandboxes()
      setStore({ sandboxes: all, picked: all.length > 0 && !store.picked ? all[0].id : store.picked })
    } catch (err) {
      setStore("error", err instanceof Error ? err.message : String(err))
    } finally {
      setStore("busy", false)
    }
  }

  async function useSelected() {
    const meta = store.sandboxes.find((s) => s.id === store.picked)
    if (!meta) return
    if (!store.password) {
      setStore("error", language.t("settings.e2b.passwordRequired"))
      return
    }
    setStore({ error: "", busy: true })
    try {
      const url = await provider().getServeUrl(meta.id, 4096)
      await connect(url)
    } catch (err) {
      setStore("error", err instanceof Error ? err.message : String(err))
    } finally {
      setStore("busy", false)
    }
  }

  async function create() {
    if (!store.password) {
      setStore("error", language.t("settings.e2b.passwordRequired"))
      return
    }
    setStore({ error: "", busy: true, progress: language.t("settings.e2b.progress.creating") })
    try {
      const p = provider()
      const created = await p.createSandbox(store.template.trim() || DEFAULT_TEMPLATE, Number(store.timeoutMin) * 60_000)
      setStore("progress", language.t("settings.e2b.progress.starting"))
      await p.startServe(created.id, envs())
      const url = await p.getServeUrl(created.id, 4096)
      setStore("progress", language.t("settings.e2b.progress.waiting"))
      await waitForServeVersion(url)
      setStore({ progress: "", sandboxes: [created, ...store.sandboxes.filter((s) => s.id !== created.id)], picked: created.id })
      await connect(url)
    } catch (err) {
      setStore({ error: err instanceof Error ? err.message : String(err), progress: "" })
    } finally {
      setStore("busy", false)
    }
  }

  async function pause(id: string) {
    setStore({ error: "", busy: true })
    try {
      await provider().pauseSandbox(id)
      await list()
    } catch (err) {
      setStore("error", err instanceof Error ? err.message : String(err))
    } finally {
      setStore("busy", false)
    }
  }

  async function forget() {
    setStore({ e2bKey: "", password: "", keysText: "", remember: false })
    try {
      await clearVault()
    } catch {}
  }

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
            <ButtonV2 variant="contrast" disabled={store.busy || !store.picked} onClick={useSelected}>
              {language.t("settings.e2b.use")}
            </ButtonV2>
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
            <span class="settings-v2-server-dialog-error">{store.error}</span>
          </Show>
        </SettingsListV2>
      </div>
    </>
  )
}
