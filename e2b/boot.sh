#!/usr/bin/env bash
# agentio sandbox boot — starts `opencode serve` for ONE sandbox.
# Run at sandbox startup from the PWA via SDK `commands.run` (background),
# NOT baked into the image: keys differ per user and must never live in a snapshot.
set -euo pipefail

: "${OPENCODE_SERVER_PASSWORD:?agentio: OPENCODE_SERVER_PASSWORD is required (per-device generated)}"
: "${OPENCODE_AUTH_CONTENT:?agentio: OPENCODE_AUTH_CONTENT is required (memory-only LLM keys JSON)}"

export OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS="${OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS:-true}"

WORKSPACE_ROOT="${AGENTIO_WORKSPACE_ROOT:-/home/user/workspace}"
CONFIG_DIR="${HOME}/.config/opencode"
mkdir -p "$CONFIG_DIR" "$WORKSPACE_ROOT"

# Stencil defaults only when the user has no config yet — never overwrite.
if [ ! -f "$CONFIG_DIR/opencode.json" ]; then
  cp /opt/agentio/opencode.json "$CONFIG_DIR/opencode.json"
fi

# opencode matches CORS origins EXACTLY (no "*" wildcard in v1.18.27), so the
# PWA passes its own origin(s) comma-separated. http://localhost:* already
# passes by default, which covers local Vite dev with empty AGENTIO_CORS_ORIGINS.
# Entries are trimmed, empties dropped, deduped, and must look like an https
# origin — anything else is rejected loudly rather than silently mismatching.
CORS_ARGS=()
declare -A _SEEN_ORIGIN=()
if [ -n "${AGENTIO_CORS_ORIGINS:-}" ]; then
  IFS=',' read -ra ORIGINS <<< "$AGENTIO_CORS_ORIGINS"
  for raw in "${ORIGINS[@]}"; do
    origin="$(echo "$raw" | xargs)"
    [ -z "$origin" ] && continue
    if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
      echo "agentio: rejecting bad CORS origin '$origin' (want https://host[:port])" >&2
      exit 1
    fi
    if [ -z "${_SEEN_ORIGIN[$origin]:-}" ]; then
      _SEEN_ORIGIN[$origin]=1
      CORS_ARGS+=(--cors "$origin")
    fi
  done
fi
echo "agentio: CORS allowlist: ${CORS_ARGS[*]:-(defaults only)}"

exec opencode serve --hostname 0.0.0.0 --port 4096 "${CORS_ARGS[@]}"
