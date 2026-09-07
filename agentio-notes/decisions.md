# agentio — decisions

Log newest first. One line why per decision.

- 2026-09-06: cold-boot crash fixed + live-verified — new session right after
  add-project crashed the whole app (`serverSync()/sync()/sdk()` transiently
  undefined mid project-bootstrap; upstream always warm so never guards).
  Fix: `src/utils/safe-read.ts` `readSync()` + guards in `use-providers.ts`,
  `context/local.tsx`, `new-session-workspace-controller.ts`,
  `new-session-view.tsx` (ProviderTip). Verified in Safari against real
  `serve v1.18.27`: wipe → add server → add project → new session → working
  composer + agent/model pickers, zero console errors.
- 2026-09-06: launcher builds standalone — `app/launcher-ws/` workspace root
  (own `workspaces.catalog`, 62 entries copied from opencode root) over COPIES
  of the 10-pkg closure (`deps/*`), reference repo never written. `tsgo -b`
  green, `vite build` green (86M dist, e2b SDK lazy: dialog → 72K tab →
  356K SDK on demand), unit 723/724.
- 2026-09-06: fork compat shims (all marked, restore on pin bump) —
  `@pierre/trees` ≤ beta.6 lacks `onExpansionChange` (no published beta has
  it; upstream source is ahead of its pin): dir picker loads children on
  select, tree test asserts handle state. `vault.ts` b64.decode returns
  `Uint8Array<ArrayBuffer>` for tsgo BufferSource strictness.
- 2026-09-06: workspace-shape shims — `app/ui` symlinks our `deps/ui` copy,
  `app/desktop` symlinks the reference (read-only) so `../../../ui|desktop`
  imports + `sound.ts` audio glob resolve exactly like the monorepo. 21 new
  `settings.e2b.*` en keys propagated as English text to all 63 locale files
  (upstream untranslated-value convention; parity tests enforce full sync).
- 2026-09-06: ONE pre-existing failure, not ours — `pa-PK` likely-subtags
  test (file byte-identical to reference, pinned bun 1.3.14 maximizes to
  `pa-Aran-PK` which the mapper doesn't know). Upstream-red at v1.18.27.
- 2026-09-06: launcher = fork of opencode `packages/app` at `v1.18.27`
  (`app/launcher/`, E2B runs headless serve same pin). Official web UI is
  same-origin on serve, so phone goes launcher → serve URL with zero extra
  hosting. E2B management is one Settings → Cloud tab (`e2b.tsx` over the
  copied `src/e2b/{cloud,vault}.ts` seam, `server.add()` reuse, `e2b@2.46.1`
  lazy). Standalone `bun install` in the fork is blocked by monorepo
  `workspace:*`/`catalog:` deps — fork builds inside the opencode checkout
  until package.json is de-workspaced (phase 2).
- 2026-09-06: `app/web` SandboxPanel gains "Open official web UI ↗"
  (last healthy serve URL, `target=_blank`). Shippable v1 of the launcher
  flow on the proven PWA stack — no waiting on the Solid fork build.
  Suite: 120 green.

- 2026-09-03: engine = opencode v1 pinned `v1.18.27` (commit `4b7e19e`).
  Only engine that survives phone disconnect natively today (serve-side
  sessions). Verified MCP-in-subagents allowed in latest code
  (`deriveSubagentSessionPermission` only carries denies + external_directory).
- 2026-09-03: cloud = E2B only, prebuilt template, FS-only pause,
  15-30min idle. Manual provisioning, discovery via E2B list.
- 2026-09-03: one `opencode serve` per sandbox (4096), sessions pass
  workspace dir. Workspace = folder in sandbox, = project, many sessions.
- 2026-09-03: auth = per-device generated password, keys via
  `OPENCODE_AUTH_CONTENT` (memory-only, never `auth.json` on disk).
  CORS allow-all v1. Share disabled. Mappings local-only.
- 2026-09-03: agents = all built-ins + CRUD; global agents+plugins store,
  per-agent permissions/subagents/skills/MCPs. No MCP preinstalled.
  Background subagents on, depth 2-3, compaction defaults, no app cap,
  auto-approve default.
- 2026-09-03: frontend = web PWA first (chat+diffs+approvals+files, no PTY),
  read-only cache offline, web push on background finish, show sandbox
  state. MIT.
- 2026-09-03: reference pins — `opencode/` at `v1.18.27`,
  `openchamber/` at `0107d77`. `cp` + modify rule, never edit references.
- 2026-09-03: Phase 0 template lands in `app/template/` (`e2b.Dockerfile`,
  `boot.sh`, `opencode.json` stencil, README). Two corrections vs spec:
  CORS allow-all impossible — v1.18.27 `cors.ts` exact-matches, so PWA
  origins go via `AGENTIO_CORS_ORIGINS` env; no starter agents shipped —
  built-ins ride in the binary and shadowing their names is unverified,
  overrides go via `opencode.json` `agent` key.

## Reference pins

- opencode: tag `v1.18.27`, commit `4b7e19e` (anomalyco/opencode)
- openchamber: commit `0107d77` (openchamber/openchamber)

## Wave 1 resolutions (2026-09-04, review-driven)

- MIT LICENSE added at repo root + `app/web` license field (was claimed, missing).
- Stencil carries explicit auto-approve `permission` allow-list (`doom_loop`
  stays ask as a stuck-loop rail). Per spec decision "configure allow".
- Version pin enforced in-app: `GET /global/health` on connect, amber
  warning on mismatch (never blocks).
- Post-resume sweep: resume triggers session re-list; chip states serve
  must be restarted (start-serve button waits for Wave 2 vault).
- `src/lib/runtime/` deleted (dead broken cp); web README corrected
  (was contradicting tasks.md); localStorage now schema-validated with
  migration + quota guard (vault hardening itself stays Wave 2).
- File-based agent/skill/markdown CRUD stays deferred (no write endpoint
  in v1.18.27) — config-key management only until E2B-direct writes.
- Test suite: 29 tests (vitest) green alongside typecheck + build.

## Wave 2 resolutions (2026-09-04)

- Per-agent skills/MCP scoping is NOT supported server-side (agent schema
  in reference `core/src/v1/config/agent.ts` has no skills/mcp keys) —
  spec amended: MCP/skills stay global, per-agent control is the
  permission matrix (which does gate MCP tools per agent). No UI change.
- Vault ships: AES-GCM IndexedDB vault (non-extractable device key),
  per-device password generation, remember-me + forget-device, mapping
  stays secret-free in localStorage with migration.
- AUTH_CONTENT dead-end closed: KeysPanel (provider keys) → assembled
  memory-only at start → PWA create (template+timeout) → boot.sh with
  vault envs → health-poll → auto-connect. Manual flow still works.

## Wave 3 + polish (2026-09-06, pre-UI/UX)

- Stub bench (`?stub=full|empty|errors`) + 95-test suite green with
  typecheck + build. Offline IDB cache (frozen banners, no fake queueing).
  `.md` authoring via guarded E2B files API. e2b code-split (~340 KiB
  lazy). Verification (real sandbox + template build) is Jay's run.

## U1 design system (2026-09-06)

- Tokens: verbatim `openchamber-dark.json` + hand-slimmed `tokens.css`
  (dark-only static vars, no generator); JSON↔CSS pinned by test.
  Primitives ported: button/cn/slot/skeleton/card/input/textarea(slim)/
  sonner+toast(dark-only)/tooltip+long-press/dialog+static-close + 11
  hand-inked icons (no sprite/remix). Deps added: cva, clsx,
  tailwind-merge, @base-ui/react, sonner. Skipped: text.tsx (motion),
  dropdown/select/command, CodeMirror, LegendList, Pierre, shiki.

## U2 chat surfaces (2026-09-06)

- Markdown: marked sync + DOMPurify gate (XSS-tested), themed classes,
  plain pre blocks, safe-link rewriter. Deps: marked, dompurify.
- MessageBubble on chat tokens; tool chips with live pulse; reasoning
  collapsible; composer on Textarea primitive + Button + ↑/↓ history.
- Approvals reskinned (Button/chip/Input primitives, token badges);
  ChangedFiles panes on tools-edit vars. Suite: 108 green.

## U3 layout rebuild (2026-09-06)

- Session view owns the viewport (`h-dvh` flex column, timeline flex-1,
  composer sibling) — page no longer scrolls under chat. Footer spacer,
  back-to-sessions affordance, session title in tab row.
- User bubble right/max-85%/tail corner; assistant unboxed markdown flow;
  composer box (radius/shadow/focus ring, icon buttons, agent chip row
  reserved); approvals inline at timeline end.
- Fresh-session empty state (mark + starters filling composer); mobile
  CSS (16px inputs kill iOS zoom, 36px targets, pill composer,
  reduced-motion). Suite: 116.

## U4 app shell + full token migration (2026-09-06, screenshot-driven)

- Sidebar + transcript replaces stacked list-over-chat (desktop persistent
  288px, mobile list-or-transcript with back affordance, desktop
  pick-a-session placeholder). Relative-time rows, filter, busy dots.
- Zero `neutral-*` ramp classes in shipped source, enforced by
  `tokens.test.ts` gate. Connect card, KeysPanel, SandboxPanel, FilesView,
  ConfigView, ChatView leftovers all on tokens + primitives. Suite: 119.

## U3 frame + states + onboarding (2026-09-06)

- Sticky AppHeader (connection dot, sandbox chip, area tabs in header),
  chat-column measure, safe-area padding. Sonner Toaster mounted;
  toasts on connect/provision/session-create/failures.
- Skeletons (sessions/chat/files/config), designed empty sessions card
  with action, token-styled banners. Onboarding Dialog wizard (E2B key
  → model key → launch → done) with full stub-driven tests. Suite: 115.

# (canonical decision log moved here from the umbrella repo)

- 2026-09-07: launcher home = this fork (jaygupta17/agentio, branch `agentio`
  off tag v1.18.27). `app/launcher` copy-fork transplanted as 3 logical
  commits; `launcher-ws` shim workspace + `app/ui`/`app/desktop` symlinks
  deleted (were machine-specific, skipped upstream patches, absolute paths).
  Verified in fork: bun install 4713 pkgs, tsgo green, unit 723/724
  (pa-PK = pre-existing upstream red), browser 41/41, vite build green 86M.
- 2026-09-07: @pierre/trees onExpansionChange shim REVERTED — the upstream
  patch for beta.4 adds it; the old shim workspace silently skipped all 18
  patchedDependencies, which is why the hack looked necessary. Live patched
  deps now match the pinned build contract.
- 2026-09-07: E2B template + boot.sh landed at `e2b/` (verbatim from
  app/template; CORS/localhost + digest-pin fixes scheduled in Phase 3).

- 2026-09-07: phase 2 lands — first-run onboarding + vault-only secrets,
  live-verified against a real serve@source in Chrome. Found + fixed root
  cause of "launcher shows nothing with no server": createSimpleContext
  gate (ui/context/helper.tsx) never opens when ServerProvider.ready() is
  false and ready() required a non-empty active key; empty list is now a
  terminal (onboarding) state. Passwords stripped from persisted server.v3
  (scrub on read + on write), credentials live only in the AES-GCM vault
  `servers` map and hydrate in-memory at boot; manual dialog + Cloud tab
  persist the vault BEFORE mutating the store. Shared src/e2b/provision.ts
  (parseKeys/bootEnvs/connectServe/createAndBoot) + classified+redacted
  errors (e2b/errors.ts). entry.tsx: no fake server in prod, health gate
  live; dev/auth_token keep injected+unhealthy-skipped path so upstream
  e2e semantics hold. boot.sh now accepts localhost + tauri://localhost +
  capacitor://localhost origins. 747 unit / 41 browser / build green.

- 2026-09-07: production bundle passes the full first-run flow against an
  authenticated local serve (vite preview 4173 -> connect -> app shell,
  persists across reload). localhost origins pass v1.18.27 CORS defaults;
  non-localhost launchers still need AGENTIO_CORS_ORIGINS at boot.
