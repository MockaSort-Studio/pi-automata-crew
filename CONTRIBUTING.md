# Contributing to hall-of-automata-cli

All contributions go through pull requests. Describe your changes clearly and link any relevant issues. See [GitHub's pull request guide](https://help.github.com/articles/about-pull-requests/) if you are new to the process.

This project is governed by the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating you agree to abide by its terms.

---

## Running locally

```bash
git clone https://github.com/MockaSort-Studio/hall-of-automata-cli
cc --plugin-dir /path/to/hall-of-automata-cli
```

To load permanently during development, add to `~/.claude/settings.json`:

```json
{
  "plugins": [
    { "path": "/path/to/hall-of-automata-cli" }
  ]
}
```

## Running tests

```bash
bash tests/validate-plugin.sh              # plugin structure
bash tests/hooks/test-guard-writes.sh      # guard-writes hook
bash tests/hooks/test-skill-guard.sh       # skill-guard hook
```

All checks must pass before opening a PR.

---

## Style guide

### Skill files (`skills/*/SKILL.md`, `methodology/*.md`)

- **200-line hard ceiling per file.** Not a guideline — if you exceed it, decompose.
- Every skill file must have valid YAML frontmatter with `name`, `description`, and `allowed-tools`.
- List only the tools the skill actually calls in `allowed-tools`. No speculative inclusions.
- Instructions to Claude go in prose outside code fences. Instructions inside a `bash` fence are read as shell commands, not as directives to the model — keep this distinction intentional.
- One responsibility per skill. A skill that does two things should be two skills.

### Shell scripts (`hooks/scripts/*.sh`, `tests/**/*.sh`)

- `set -euo pipefail` at the top of every script.
- No hardcoded paths — use `CLAUDE_PLUGIN_ROOT` or derive paths from `$0`.
- Quote all variable expansions: `"$VAR"`, `"${VAR}"`.
- Comments explain *why*, not *what*. Rename before you comment.

### Python (`scripts/*.py`)

- Python 3.11+.
- Type annotations on all function signatures.
- No mutable default arguments.
- No bare `except:` — catch specific exceptions.
- `ruff` for formatting and linting. Line length: 100.

---

## What belongs here vs. hall-of-automata

| Change | Repo |
|--------|------|
| Skill files, methodology, templates, hooks | **hall-of-automata-cli** (this repo) |
| CI workflows, dispatch logic, invoke scripts | **hall-of-automata** |
| Specialist souls (`.pi/extensions/hall-crew/crew/roster/*.md`), Crew agent catalog (`.pi/extensions/hall-crew/crew/agents/agents.json`) | **hall-of-automata-cli** |

If you are unsure, open an issue first.
