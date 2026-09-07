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
- [ ] entry.tsx: stop injecting fake same-origin/localhost server;
      enable ConnectionGate health check
- [ ] First-run onboarding gate: E2B path + "connect remote serve" path
      (URL + username + password, cross-origin tested)
- [ ] Vault-only secrets: strip password from persisted server.v3,
      hydrate from vault, one-time migration
- [ ] Replace safe-read catch-all with real connection-state gate
- [ ] Port toUserError/redactSecrets + SSE fatal-vs-reconnect from web
- [ ] CORS: onboarding collects allowed origins; native-shell origins
      (tauri://localhost, capacitor://localhost) in the design

## Phase 3 — E2B lifecycle
- [ ] Restart-serve after FS-only pause (explicit affordance)
- [ ] AbortSignal + backoff in waitForServeVersion poll
- [ ] Normalize URL before server.add (dedup); persist secrets before connect
- [ ] boot.sh: allow http://localhost + native origins; pin Dockerfile digest
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
