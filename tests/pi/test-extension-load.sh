#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/.pi"
cp -R "$ROOT/.pi/extensions" "$TMP/.pi/extensions"
if rg -n '(/Users/|Workspace/|pi\.agents|pi\.tools\.call)' "$TMP/.pi/extensions"; then
  echo "Extension source contains a host-specific path or unsupported Pi API" >&2
  exit 1
fi

cat > "$TMP/assert-tools.ts" <<'EOF'
export default function (pi) {
  const available = new Set(pi.getAllTools().map(tool => tool.name));
  const required = [
    "start_crew", "build_crew_member", "crew_register", "crew_unregister",
    "crew_begin_close", "crew_finish_close", "crew_close",
    "web_fetch",
    "runtime_spawn_agent", "runtime_list_agents", "runtime_inspect_agent", "runtime_delete_agent",
  ];
  const missing = required.filter(name => !available.has(name));
  if (missing.length) throw new Error(`Missing registered tools: ${missing.join(", ")}`);
}
EOF

cd "$TMP"
PI_OFFLINE=1 pi \
  --no-extensions \
  --no-context-files \
  --no-skills \
  --no-prompt-templates \
  --no-themes \
  -e .pi/extensions/hall-crew/crew/index.ts \
  -e .pi/extensions/web/index.ts \
  -e .pi/extensions/hall-crew/crew-runtime/index.ts \
  -e ./assert-tools.ts \
  --list-models \
  --offline >/dev/null

echo "Pi extensions load from a relocated install tree"
