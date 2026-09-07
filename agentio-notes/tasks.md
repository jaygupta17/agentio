# agentio — tasks

## Done (2026-09-07 recovery)
- [x] Baseline git snapshot of old umbrella repo (pre-migration, byte-exact)
- [x] Launcher transplanted into this fork: branch `agentio` off `v1.18.27`,
      E2B layer + cold-boot guards as reviewable commits
- [x] Real build verified in fork: install + typecheck + 723/724 unit
      (known upstream red: pa-PK Intl) + 41/41 browser + vite build
- [x] launcher-ws shim workspace + app/ui + app/desktop symlinks deleted
- [x] @pierre/trees compat shim reverted (upstream patch provides hook)
- [x] E2B template moved to `e2b/`

## Phase 2 — make it the actual product
- [x] entry.tsx: no fake server in prod; ConnectionGate live (dev/auth_token keep injected path)
- [x] Prod-bundle smoke: vite preview (4173) + serve w/ OPENCODE_SERVER_PASSWORD →
      first-run screen → manual connect → app shell; reload keeps session
- [x] First-run onboarding gate: E2B wizard + remote serve form (verified in Chrome against real serve)
- [x] Vault-only secrets: scrub read + strip write + vault.servers hydrate (live-verified: no password in localStorage)
- [ ] Replace safe-read catch-all with real connection-state gate
- [x] Port classifyError/redactSecrets from web (SSE fatal-vs-reconnect port deferred to next pass)
- [x] CORS: bootEnvs filters unsafe origins client-side; boot.sh accepts localhost + native-shell origins

## Phase 3 — E2B lifecycle
- [ ] Restart-serve after FS-only pause (explicit affordance)
- [ ] AbortSignal + backoff in waitForServeVersion poll
- [ ] Normalize URL before server.add (dedup); persist secrets before connect
- [x] boot.sh: localhost + native origins allowed; [ ] Dockerfile digest still unpinned
- [ ] Regenerate vendored @opencode-ai/client at next pin bump

## Phase 4 — acceptance (Jay, real device)
- [ ] Fresh profile → onboard E2B → chat → pause → resume+restart-serve
- [ ] Manual connect LAN serve from phone Safari
- [ ] Approvals + files + config round-trip cross-origin

## Deferred
- Offline cache, PWA push, share feature, Tauri spike, V1_API_MIGRATION
  remainder (do at next pin bump), mobile/Expo.

## Historical (umbrella repo, pre-migration) — archived
Phase 0-3 + waves 0-3 + U1-U4: see git log of the umbrella repo.
