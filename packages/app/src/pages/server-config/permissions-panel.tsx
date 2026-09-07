// Global (or project) permission matrix editor. Reads the SOURCE config for
// the active scope, writes whole-section replacements through the
// scope-appropriate service (see write-service.ts for the merge semantics).

import { Show, createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { createMutation, createQuery } from "@tanstack/solid-query"
import {
  emptyPermissionModel,
  parsePermissionConfig,
  permissionModelsEqual,
  serializePermissionModel,
  type PermissionModel,
} from "@/server-config/permissions"
import { createGlobalWriteService, createProjectWriteService } from "./write-service"
import { PermissionEditor } from "./permission-editor"
import { SectionHeader, SaveBar, ReadOnlyBanner } from "./atoms"
import { configQueryKey, useErrorText, type ConfigScope } from "./shared"
import { SANDBOX_CONFIG_DIR } from "@/server-config/files"

export function PermissionsPanel(props: { scope: ConfigScope }) {
  const language = useLanguage()
  const errorText = useErrorText()
  const [state, setState] = createStore({
    model: emptyPermissionModel() as PermissionModel,
    loaded: emptyPermissionModel() as PermissionModel,
    error: "",
    notice: "",
  })

  function service() {
    const directory = props.scope.directory()
    const files = props.scope.files()
    if (directory) {
      if (!files) return undefined
      return { kind: "project" as const, service: createProjectWriteService({ files: () => files, worktree: directory }) }
    }
    return {
      kind: "global" as const,
      service: createGlobalWriteService({
        target: props.scope.target(),
        files: props.scope.files,
        sandboxConfigDir: SANDBOX_CONFIG_DIR,
      }),
    }
  }

  const config = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "permission"),
    queryFn: async () => {
      const s = service()
      if (!s) return undefined
      setState({ error: "", notice: "" })
      try {
        return await s.service.read()
      } catch (err) {
        setState("error", errorText(err))
        return undefined
      }
    },
    enabled: () => !!service(),
  }))

  createEffect(() => {
    const doc = config.data
    if (!doc) return
    const model = parsePermissionConfig(doc.permission)
    setState({ model, loaded: model })
  })

  const dirty = () => !permissionModelsEqual(state.model, state.loaded)

  const save = createMutation(() => ({
    mutationFn: async () => {
      const s = service()
      if (!s) throw new Error("scope not writable")
      const value = serializePermissionModel(state.model)
      if (value) {
        await s.service.setSection("permission", value)
        return
      }
      // cleared everything: remove the section where possible; a merge-patch
      // cannot delete, so remote scopes explain instead.
      const removePath = (s.service as { removePath?: (path: Array<string | number>) => Promise<void> }).removePath
      if (removePath) await removePath(["permission"])
      else setState("notice", language.t("config.permission.clearRemote"))
    },
    onSuccess: () => {
      setState("loaded", state.model)
      void config.refetch()
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  return (
    <div class="flex flex-col gap-4 min-w-0">
      <SectionHeader title={language.t("config.permissions")} description={language.t("config.permissionsHint")} />
      <Show when={!props.scope.fileCapable()}>
        <ReadOnlyBanner text={language.t("config.permissionsRemoteHint")} />
      </Show>
      <PermissionEditor model={state.model} onChange={(model) => setState("model", model)} />
      <Show when={state.error}>
        <span class="text-12-regular text-text-danger">{state.error}</span>
      </Show>
      <Show when={state.notice}>
        <span class="text-12-regular text-text-warn">{state.notice}</span>
      </Show>
      <SaveBar
        dirty={dirty()}
        saving={save.isPending}
        onSave={() => void save.mutate()}
        onDiscard={() => setState("model", state.loaded)}
      />
    </div>
  )
}
