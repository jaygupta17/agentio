# app/template — E2B snapshot definition (agentio v1)

## Env contract (set by the PWA at sandbox start, never baked in)

| Var | Required | What |
| --- | --- | --- |
| `OPENCODE_SERVER_PASSWORD` | yes | per-device generated 32B secret, Basic auth (`opencode:<pass>`) |
| `OPENCODE_AUTH_CONTENT` | yes | LLM keys JSON (`{providerID: {type:"api",key}}`), memory-only, never written to `auth.json` |
| `OPENCODE_SERVER_USERNAME` | no | defaults `opencode` |
| `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` | no | defaults `true` (spec: background fan-out on) |
| `AGENTIO_CORS_ORIGINS` | no | comma-separated PWA origins, e.g. `https://app.example.com`. `http://localhost:*` already passes by default (covers Vite dev) |
| `AGENTIO_WORKSPACE_ROOT` | no | defaults `/home/user/workspace`. Workspaces = subfolders, many per sandbox |

## Flows

Build: `cd app/template && e2b template build -n agentio-opencode-v1`
→ record template ID + base digest in `decisions.md`.

Start (PWA): `Sandbox.create(template, env={...above})` →
`commands.run("/opt/agentio/boot.sh", background=true)` →
`getHost(4096)` → `createOpencodeClient({baseUrl, headers:{Authorization:Basic}})` →
`sessions.create({location:{directory:/home/user/workspace/<name>}})` per workspace.

Pause: FS-only (`keepMemory:false`), 15–30min idle. Reboot on resume:
files + SQLite survive, running procs don't — PWA marks pre-pause busy
sessions interrupted and re-lists on reconnect.

## Manual sandbox (spec: user provisions, PWA discovers)

```sh
# 1. create from this template (E2B dashboard, CLI, or SDK)
e2b sandbox create --template agentio-opencode-v1   # or Sandbox.create('agentio-opencode-v1')

# 2. start serve inside (SDK commands.run background, or any shell in it)
export OPENCODE_SERVER_PASSWORD='<per-device secret>'
export OPENCODE_AUTH_CONTENT='{"anthropic":{"type":"api","key":"…"}}'
export AGENTIO_CORS_ORIGINS='https://<your-pwa-origin>'
/opt/agentio/boot.sh &

# 3. in the PWA: paste E2B key → List my sandboxes → Use selected.
#    PWA connects via getHost(4096) (auto-resumes if paused) and can
#    Pause (keep files) / Resume from the sandbox chip afterwards.
```

## Corrections vs frozen spec

- CORS "allow all" is NOT implementable: v1.18.27 `cors.ts`
  (`isAllowedCorsOrigin`) exact-matches the allowlist, no `"*"` wildcard.
  Hence explicit origins via `AGENTIO_CORS_ORIGINS`.
- No starter `.opencode/agents/*.md` shipped: built-ins (`build/plan/
  general/explore`) already ride in the binary, and shadowing their names
  with custom files has unverified merge semantics. Overrides (if ever
  needed) go through the `agent:{name:{permission}}` key in `opencode.json`,
  which provably merges over defaults. `general` inherits MCP tools by
  default; `explore` stays read-only.

## Bump policy

Pin opencode tag + verify `install`-script URL shape
(`opencode-linux-x64.tar.gz` for E2B amd64) before changing
`OPENCODE_VERSION`. Template + PWA SDK bump together; app asserts serve
version on connect and warns on mismatch.
