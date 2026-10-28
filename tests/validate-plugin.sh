#!/usr/bin/env bash
set -euo pipefail

PASS=0; FAIL=0

check() {
  local desc="$1"; local cmd="$2"
  if bash -c "$cmd" &>/dev/null; then
    echo "  PASS: $desc"; PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"; FAIL=$((FAIL + 1))
  fi
}

echo "=== Plugin scaffold validation ==="
check "plugin.json exists"        "test -f .claude-plugin/plugin.json"
check "plugin.json valid JSON"    "python3 -m json.tool .claude-plugin/plugin.json"
check "plugin name is kebab-case" "python3 -c \"import json,re,sys; d=json.load(open('.claude-plugin/plugin.json')); sys.exit(0 if re.match(r'^[a-z][a-z0-9]*(-[a-z0-9]+)*$', d['name']) else 1)\""
check ".mcp.json exists"          "test -f .mcp.json"
check ".mcp.json valid JSON"      "python3 -m json.tool .mcp.json"
check "mcp.json has sequential-thinking" "python3 -c \"import json,sys; d=json.load(open('.mcp.json')); sys.exit(0 if 'sequential-thinking' in d else 1)\""
check "mcp.json has fetch"      "python3 -c \"import json,sys; d=json.load(open('.mcp.json')); sys.exit(0 if 'fetch' in d else 1)\""
check "mcp.json has github"        "python3 -c \"import json,sys; d=json.load(open('.mcp.json')); sys.exit(0 if 'github' in d else 1)\""
check "mcp.json has google-drive"  "python3 -c \"import json,sys; d=json.load(open('.mcp.json')); sys.exit(0 if 'google-drive' in d else 1)\""

# Skills
for CMD in hall-open hall-close hall-status hall-dispatch hall-reply hall-consultations hall-prune; do
  check "skills/$CMD/SKILL.md exists" "test -f skills/$CMD/SKILL.md"
  check "skills/$CMD/SKILL.md has frontmatter" "grep -q '^---' skills/$CMD/SKILL.md"
  check "skills/$CMD/SKILL.md has name field" "grep -q '^name:' skills/$CMD/SKILL.md"
done

# hall-review
check "skills/hall-review/SKILL.md exists"                  "test -f skills/hall-review/SKILL.md"
check "skills/hall-review/SKILL.md has frontmatter"         "grep -q '^---' skills/hall-review/SKILL.md"
check "skills/hall-review/SKILL.md has name field"          "grep -q '^name:' skills/hall-review/SKILL.md"
check "skills/hall-review/SKILL.md has description field"   "grep -q '^description:' skills/hall-review/SKILL.md"
check "skills/hall-review/SKILL.md has allowed-tools field" "grep -q '^allowed-tools:' skills/hall-review/SKILL.md"
check "skills/hall-dispatch/SKILL.md is under 200 lines"    "[ \$(wc -l < skills/hall-dispatch/SKILL.md) -le 200 ]"
check "skills/hall-open/SKILL.md is under 200 lines"        "[ \$(wc -l < skills/hall-open/SKILL.md) -le 200 ]"
check "scripts/hall-open-setup.py exists"                   "test -f scripts/hall-open-setup.py"
check "scripts/verify-personas.py exists"                   "test -f scripts/verify-personas.py"
check "hall-route has on-demand overlay render"              "grep -q 'Local consultation overlay' skills/hall-route/SKILL.md"
check "hall-review fetches persona on-demand"               "grep -q 'gh api.*roster' skills/hall-review/SKILL.md"
check "skills/hall-open/invoker-gate.md exists"             "test -f skills/hall-open/invoker-gate.md"

# Methodology
for F in old-major-cli; do
  check "methodology/$F.md exists" "test -f methodology/$F.md"
done
check "no orphaned methodology files" \
  "for MD in methodology/*.md; do base=\$(basename \"\$MD\" .md); [ \"\$base\" = 'old-major-cli' ] && continue; grep -ql \"\$base\" methodology/old-major-cli.md skills/*/SKILL.md 2>/dev/null || exit 1; done"

# Templates
check "templates/subagent-overlay.md.tpl exists"    "test -f templates/subagent-overlay.md.tpl"
check "subagent overlay fetches base persona on-demand"     "grep -q 'get_file_contents' templates/subagent-overlay.md.tpl"
check "templates/dispatch-body-pr.md.tpl exists"     "test -f templates/dispatch-body-pr.md.tpl"
check "templates/dispatch-body-report.md.tpl exists"  "test -f templates/dispatch-body-report.md.tpl"

# Template @-import guard: overlay templates loaded via Read must not contain @-import lines
for TPL in templates/*-overlay.md.tpl; do
  check "No unresolved @-imports in $(basename "$TPL")" \
    "! sed 's/{{[^}]*}}/DUMMY/g' \"$TPL\" | grep -q '^@'"
done

# Hooks
check "hooks/hooks.json valid JSON"            "python3 -m json.tool hooks/hooks.json"
check "hooks/scripts/guard-writes.sh exists"   "test -f hooks/scripts/guard-writes.sh"
check "guard-writes.sh is executable"          "test -x hooks/scripts/guard-writes.sh"
check "no dangling /hall:reconcile references" \
  "! git grep -nE 'hall-reconcile|hall:reconcile' -- ':(exclude)tests/**' '*.md' '*.sh' '*.py'"
check "no dangling board-context.md references" \
  "! git grep -n 'board-context\\.md' -- ':(exclude)tests/**' '*.md' '*.sh' '*.py'"

# Pi migration
check "Pi extension load test is executable" "test -x tests/pi/test-extension-load.sh"
if command -v pi >/dev/null 2>&1; then
  check "Pi extensions load from relocated tree" "bash tests/pi/test-extension-load.sh"
fi

echo; echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
