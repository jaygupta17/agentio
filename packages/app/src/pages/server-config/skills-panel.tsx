// Skills. Listing works over HTTP on every server (GET /skill; content is
// the frontmatter-stripped body, description is in the payload). Authoring
// SKILL.md files is E2B-only since opencode serve has no file-write
// endpoint — remote scopes get read-only content + an explanation. The
// discovery config (skills.paths / skills.urls) stays editable everywhere.

import { For, Show, createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { listSkills } from "@/server-config/api"
import { buildSkillMarkdown } from "@/server-config/codecs"
import { configQueryKey, useErrorText, type ConfigScope } from "./shared"
import { createGlobalWriteService, createProjectWriteService, entityRoot, type WriteService } from "./write-service"
import { SANDBOX_CONFIG_DIR } from "@/server-config/files"
import { EmptyState, Field, ReadOnlyBanner, SaveBar, SectionHeader } from "./atoms"

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/

export function SkillsPanel(props: { scope: ConfigScope }) {
  const language = useLanguage()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [state, setState] = createStore({
    selected: "",
    isNew: false,
    draft: { name: "", description: "", instructions: "" },
    editing: false,
    edit: { description: "", instructions: "" },
    editBaseline: { description: "", instructions: "" },
    paths: "",
    urls: "",
    pathsBaseline: "",
    urlsBaseline: "",
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

  const skills = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "skills"),
    queryFn: () => listSkills(props.scope.target()),
    enabled: () => !!props.scope.serverKey(),
  }))

  const configQuery = createQuery(() => ({
    queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "skills-source"),
    queryFn: () => writeService()?.read(),
    enabled: () => !!writeService(),
  }))

  createEffect(() => {
    const doc = configQuery.data
    if (!doc) return
    const paths = (doc.skills?.paths ?? []).join("\n")
    const urls = (doc.skills?.urls ?? []).join("\n")
    setState({ pathsBaseline: paths, urlsBaseline: urls })
    if (!state.selected || !state.editing) setState({ paths, urls })
  })

  const visible = createMemo(() => (skills.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)))
  const selectedSkill = createMemo(() => visible().find((skill) => skill.name === state.selected))

  function select(name: string) {
    const skill = visible().find((entry) => entry.name === name)
    setState({
      selected: name,
      isNew: false,
      editing: false,
      error: "",
      edit: { description: skill?.description ?? "", instructions: skill?.content ?? "" },
      editBaseline: { description: skill?.description ?? "", instructions: skill?.content ?? "" },
    })
  }

  const editable = createMemo(() => {
    const files = props.scope.files()
    const location = selectedSkill()?.location
    return !!files && !!location && files.allowed(location)
  })

  const saveSkill = createMutation(() => ({
    mutationFn: async () => {
      const files = props.scope.files()
      const skill = selectedSkill()
      if (!files || !skill) throw new Error(language.t("config.skills.remoteHint"))
      if (!files.allowed(skill.location)) throw new Error(language.t("config.skills.readOnlyLocation"))
      await files.write(
        skill.location,
        buildSkillMarkdown({
          name: skill.name,
          ...(state.edit.description.trim() ? { description: state.edit.description.trim() } : {}),
          instructions: state.edit.instructions,
        }),
      )
      setState({ editing: false, editBaseline: state.edit })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "skills") })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const createSkill = createMutation(() => ({
    mutationFn: async () => {
      const files = props.scope.files()
      if (!files) throw new Error(language.t("config.skills.remoteHint"))
      const name = state.draft.name.trim()
      if (!SKILL_NAME_RE.test(name)) throw new Error(language.t("config.skills.invalidName"))
      const root = entityRoot({
        configDir: SANDBOX_CONFIG_DIR,
        ...(props.scope.directory() ? { worktree: props.scope.directory() } : {}),
      })
      await files.write(
        `${root}/skills/${name}/SKILL.md`,
        buildSkillMarkdown({
          name,
          ...(state.draft.description.trim() ? { description: state.draft.description.trim() } : {}),
          instructions: state.draft.instructions,
        }),
      )
      setState({ isNew: false, selected: "", draft: { name: "", description: "", instructions: "" } })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "skills") })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const removeSkill = createMutation(() => ({
    mutationFn: async () => {
      const files = props.scope.files()
      const location = selectedSkill()?.location
      if (!files || !location || !files.allowed(location)) throw new Error(language.t("config.deleteRequiresSandbox"))
      await files.remove(location)
      setState({ selected: "", editing: false })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "skills") })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const saveDiscovery = createMutation(() => ({
    mutationFn: async () => {
      const service = writeService()
      if (!service) throw new Error("scope not writable")
      const toList = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean)
      await service.setSection("skills", { paths: toList(state.paths), urls: toList(state.urls) })
      setState({ pathsBaseline: state.paths, urlsBaseline: state.urls })
      await queryClient.invalidateQueries({ queryKey: configQueryKey(props.scope.serverKey(), props.scope.directory(), "skills") })
    },
    onError: (err) => setState("error", errorText(err)),
  }))

  const discoveryDirty = createMemo(() => state.paths !== state.pathsBaseline || state.urls !== state.urlsBaseline)
  const editDirty = createMemo(() => state.edit.description !== state.editBaseline.description || state.edit.instructions !== state.editBaseline.instructions)

  return (
    <div class="flex flex-col gap-4 min-w-0">
      <Show when={!props.scope.fileCapable()}>
        <ReadOnlyBanner text={language.t("config.skills.remoteHint")} />
      </Show>
      <div class="flex gap-6 min-w-0">
      <div class="flex flex-col gap-1 w-56 shrink-0">
        <Show when={props.scope.fileCapable()}>
          <ButtonV2
            variant="neutral"
            class="justify-start"
            onClick={() => setState({ isNew: true, selected: "", draft: { name: "", description: "", instructions: "" }, error: "" })}
          >
            + {language.t("config.skills.new")}
          </ButtonV2>
        </Show>
        <For each={visible()}>
          {(skill) => (
            <button
              type="button"
              onClick={() => select(skill.name)}
              class={`flex flex-col items-start px-3 py-2 rounded-lg text-left ${
                state.selected === skill.name && !state.isNew ? "bg-surface-raised-base" : "hover:bg-surface-raised-base-hover"
              }`}
            >
              <span class="text-12-medium text-text-strong">{skill.name}</span>
              <Show when={skill.description}>
                <span class="text-12-regular text-text-weak truncate w-full">{skill.description}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="flex flex-col gap-4 min-w-0 flex-1">
        <Show when={!state.selected && !state.isNew}>
          <EmptyState text={language.t("config.skills.pick")} />
        </Show>

        <Show when={state.isNew}>
          <SectionHeader title={language.t("config.skills.new")} />
          <Field label={language.t("config.skills.name")} hint={language.t("config.skills.nameHint")}>
            <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.draft.name} onInput={(e) => setState("draft", "name", e.currentTarget.value)} />
          </Field>
          <Field label={language.t("config.commands.description")}>
            <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.draft.description} onInput={(e) => setState("draft", "description", e.currentTarget.value)} />
          </Field>
          <Field label={language.t("config.skills.instructions")}>
            <TextareaV2 rows={10} class="w-full font-mono" value={state.draft.instructions} onInput={(e) => setState("draft", "instructions", e.currentTarget.value)} />
          </Field>
          <div class="flex gap-2">
            <ButtonV2 variant="neutral" onClick={() => setState("isNew", false)}>{language.t("config.cancel")}</ButtonV2>
            <ButtonV2 variant="contrast" disabled={!state.draft.name.trim() || createSkill.isPending} onClick={() => void createSkill.mutate()}>
              {language.t("config.save")}
            </ButtonV2>
          </div>
        </Show>

        <Show when={state.selected && !state.isNew && selectedSkill()}>
          <SectionHeader title={state.selected}>
            <Show when={editable()}>
              <ButtonV2 variant="neutral" disabled={removeSkill.isPending} onClick={() => void removeSkill.mutate()}>
                {language.t("config.delete")}
              </ButtonV2>
              <ButtonV2 variant={state.editing ? "neutral" : "contrast"} onClick={() => setState("editing", !state.editing)}>
                {state.editing ? language.t("config.cancel") : language.t("config.edit")}
              </ButtonV2>
            </Show>
          </SectionHeader>
          <Show when={!editable()}>
            <ReadOnlyBanner text={language.t(props.scope.fileCapable() ? "config.skills.readOnlyLocation" : "config.skills.remoteHint")} />
          </Show>
          <Show when={state.editing}>
            <Field label={language.t("config.commands.description")}>
              <TextInputV2 appearance="large" class="!w-full self-stretch" value={state.edit.description} onInput={(e) => setState("edit", "description", e.currentTarget.value)} />
            </Field>
            <Field label={language.t("config.skills.instructions")}>
              <TextareaV2 rows={14} class="w-full font-mono" value={state.edit.instructions} onInput={(e) => setState("edit", "instructions", e.currentTarget.value)} />
            </Field>
            <SaveBar
              dirty={editDirty()}
              saving={saveSkill.isPending}
              onSave={() => void saveSkill.mutate()}
              onDiscard={() => setState({ edit: state.editBaseline, editing: false })}
            />
          </Show>
          <Show when={!state.editing}>
            <div class="flex flex-col gap-1">
              <span class="text-12-regular text-text-weak font-mono truncate">{selectedSkill()?.location}</span>
              <pre class="text-12-regular text-text-base whitespace-pre-wrap font-mono bg-surface-base rounded-lg p-3 max-h-[60vh] overflow-y-auto">{selectedSkill()?.content}</pre>
            </div>
          </Show>
        </Show>

        <div class="flex flex-col gap-3 border-t border-border-weak pt-4">
          <SectionHeader title={language.t("config.skills.discovery")} description={language.t("config.skills.discoveryHint")} />
          <Field label={language.t("config.skills.paths")} hint={language.t("config.skills.pathsHint")}>
            <TextareaV2 rows={3} class="w-full font-mono" value={state.paths} onInput={(e) => setState("paths", e.currentTarget.value)} />
          </Field>
          <Field label={language.t("config.skills.urls")}>
            <TextareaV2 rows={3} class="w-full font-mono" value={state.urls} onInput={(e) => setState("urls", e.currentTarget.value)} />
          </Field>
          <SaveBar
            dirty={discoveryDirty()}
            saving={saveDiscovery.isPending}
            onSave={() => void saveDiscovery.mutate()}
            onDiscard={() => setState({ paths: state.pathsBaseline, urls: state.urlsBaseline })}
          />
        </div>

        <Show when={state.error}>
          <span class="text-12-regular text-text-danger">{state.error}</span>
        </Show>
      </div>
      </div>
    </div>
  )
}
