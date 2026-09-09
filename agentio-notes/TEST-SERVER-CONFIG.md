# Server config — Phase D test plan

Branch: `agentio` on `jaygupta17/agentio`. Last verified commit: `e9ef462310`.

Scope: the `/server-config` page (entry: ⌘K → "Configure server") plus the
vault-only secrets model it relies on.

## 0. Setup (isolated, never touches your real opencode config)

```bash
# terminal 1 — opencode serve with a throwaway config dir
rm -rf /tmp/agentio-test && mkdir -p /tmp/agentio-test/xdg /tmp/agentio-test/proj
cd /tmp/agentio-test/proj && git init -q .
cd <fork>/packages/opencode
env -u OPENCODE_SERVER_PASSWORD -u OPENCODE_SERVER_USERNAME \
  XDG_CONFIG_HOME=/tmp/agentio-test/xdg \
  bun run ./src/index.ts serve --port 4097
# healthy? curl -s http://127.0.0.1:4097/global/health

# terminal 2 — launcher
cd <fork>/packages/app && bun dev -- --port 4444
```

Or with auth (closer to E2B behavior):
`OPENCODE_SERVER_PASSWORD=<pw> OPENCODE_SERVER_USERNAME=opencode` on the serve
line instead, and enter the same credentials in the connect form.

**Watch out:** if your shell leaks `OPENCODE_SERVER_PASSWORD` (persistent
sessions inherit it), an "unsecured" serve will 401 — always `env -u` the
two vars when you want the no-auth case.

## 1. Onboarding + connection (any browser; Safari separately in §4)

1. Fresh profile (or `http://localhost:4444/?onboard`).
2. "Connect an existing server" → URL `http://127.0.0.1:4097`, user `opencode`,
   blank password (no-auth serve) → Connect → app shell (Projects / Add project).
3. Wrong password → error banner, nothing registered. (Auth serve case.)
4. Devtools check: `localStorage["opencode.global.dat:server"]` contains the
   server **without** `password`; it lives in IndexedDB `agentio-vault`
   (`servers` map, `{iv,data}` envelope).
5. Reload (no `?onboard`) → still connected, no onboarding.

## 2. Config page — global scope (works on every server)

Open `/server-config`. Expected: six sections, scope `Global` active.

- **Permissions:** set agent-default `*` → Ask → Save (must enable only when
  dirty) → `/tmp/agentio-test/xdg/opencode/opencode.jsonc` contains
  `"permission": {"*": "ask"}`; `GET /global/config` agrees. Per-key matrix +
  pattern row (`bash` → `git commit*` allow) round-trips the same way.
- **Agents & subagents:** New agent `smoke-review` (lowercase/dashes only),
  mode Subagent, leave model empty → Save → appears in left list and in
  `GET /agent`. Open it → override permission (e.g. `edit` deny) → Save →
  `GET /agent` shows merged permission. Built-ins show the override banner;
  deleting is disabled with an explanation on remote (no sandbox binding).
- **Commands:** New `/deploysmoke` with `template: "deploy $ARGUMENTS"` →
  shows in list and in `GET /command`.
- **MCP:** Add remote entry (name `smoke-mcp`, url `https://example.invalid/mcp`)
  → row appears; status shows `failed` (expected for a dead URL — proves the
  live-status call works). Toggle Enabled off → saves. Delete → refuses with
  sandbox explanation on remote; connect/disconnect fire without reload.
- **Plugins:** Add `opencode-smoke@latest` → Save → entry persists in the file;
  remove works (arrays are replaced whole — valid remotely).
- **Skills:** on a remote server you must see a read-only banner and no
  create button; discovery `paths`/`urls` still editable.
- **Providers deep-link:** nav-footer "Provider keys ↗" opens Settings on the
  Providers tab.
- **Project scope chip:** picking a project on a **remote** server swaps the
  whole page for the needs-sandbox gate with a "switch to Global" action.

## 3. E2B sandbox (requires your E2B API key — the part only you can run)

1. `cd e2b && e2b template build -n agentio-opencode-v1` (digest is pinned;
   expect `opencode.json` stencil copied into `$HOME/.config/opencode`).
2. Launcher: onboarding E2B path (key → model key → launch) → auto-connect.
3. On that server the page must show file capability (delete buttons present,
   Skills create button present, no remote banners).
4. Agent: create `e2e-agent`, check "also write as agents/e2e-agent.md" →
   file exists in the sandbox (SandboxPanel/files or `sbx.files.read`),
   then **delete** it → both config entry and file are gone.
5. Skills: create `e2e-skill` with instructions → `skills/e2e-skill/SKILL.md`;
   edit description → file updated.
6. Project scope: pick a project, edit anything → restart badge appears in the
   header → Apply → `GET /agent` (and behavior) reflects the file edits;
   badge clears.
7. Pause sandbox from Settings → Cloud → Wake (+restart serve) → page keeps
   working without re-onboarding.

## 4. Safari pass (WebKit is the port target)

Same as §1–2 but in real Safari (not Playwright). The load-bearing items are
the vault: after connecting, confirm `agentio-vault` in IndexedDB holds a
non-extractable `CryptoKey` (`dek` passes `instanceof CryptoKey`) plus an
`{iv,data}` envelope, and a reload still connects. (Verified 2026-09-07.)

## 5. Known sharp edges while testing

- Save enables **only** when the form differs from the last loaded snapshot
  (`dirty`). If it won't enable, the form didn't change.
- Global JSONC files get leaf-level merges on PATCH; JSON files get deep
  merges. Panels always send whole sections, safe under both — but hand-edited
  concurrent changes to the same section can race last-write-wins.
- Writes to `/tmp/agentio-test/xdg` files land via the server's own update
  path; direct sandbox file writes (E2B) go through the jailed files seam —
  anything outside `~/.config/opencode`, `<worktree>/.opencode`,
  `opencode.json(c)` or `AGENTS.md` is refused before any network call.
- `POST /mcp` (ephemeral connect) is instance-scoped; it is NOT persisted —
  the row in the file is what survives a restart.
