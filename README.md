# opencode-rtk

An [OpenCode](https://opencode.ai) plugin that transparently rewrites eligible bash commands to use [RTK](https://github.com/rtk-ai/rtk) (Rust Token Killer), reducing LLM token consumption by **60–99%** on common developer commands.

## How it works

```mermaid
flowchart TD
    A([User prompt]) --> B[LLM decides to call bash tool]
    B --> C{tool.execute.before\nhook fires}

    C --> D{tool === 'bash'?}
    D -- No --> Z([Pass through unchanged])
    D -- Yes --> E{plugin enabled?}
    E -- No --> Z
    E -- Yes --> F{already starts\nwith 'rtk '?}
    F -- Yes --> Z
    F -- No --> G{simple command?\nno pipes / chains\n/ heredocs}
    G -- No --> Z
    G -- Yes --> H{matches a pattern\nin commands\[\]?}
    H -- No --> Z
    H -- Yes --> I[Apply rewrite\nvia rewriteMap\nor prefix 'rtk ']

    I --> J([OpenCode executes\nrewritten command])
    J --> K([RTK binary compresses\noutput])
    K --> L([LLM receives\n60–99% fewer tokens])

    style L fill:#22c55e,color:#fff
    style Z fill:#94a3b8,color:#fff
```

### Token savings at a glance

| Command | Before | After | Savings |
|---|---|---|---|
| `git status` | ~120 tokens | ~30 tokens | **75%** |
| `cargo test` | ~4,823 tokens | ~11 tokens | **99%** |
| `cat src/main.rs` | ~10,176 tokens | ~504 tokens | **95%** |
| `ls` | ~200 tokens | ~40 tokens | **80%** |
| `docker ps` | ~300 tokens | ~60 tokens | **80%** |

---

## Prerequisites

- [OpenCode](https://opencode.ai) installed
- [RTK](https://github.com/rtk-ai/rtk) binary installed and in `PATH`

```bash
rtk --version   # verify RTK is installed
```

---

## Installation

### Option 1 — npm plugin (recommended)

Add `opencode-rtk` to the `plugin` array in your OpenCode config:

**`~/.config/opencode/opencode.json`**
```json
{
  "plugin": ["opencode-rtk"]
}
```

OpenCode automatically installs npm plugins via Bun on startup. No separate install step needed.

### Option 2 — bunx / npx one-liner

If you prefer to install the package manually before starting OpenCode:

```bash
# with Bun
bunx opencode-rtk

# with npm
npx opencode-rtk
```

Then add it to your `opencode.json` as shown in Option 1.

### Option 3 — local clone

```bash
git clone https://github.com/monachy/opencode-rtk.git
cd opencode-rtk
bun install
bun run build
```

Then reference the local path in your OpenCode config:

**`~/.config/opencode/opencode.json`**
```json
{
  "plugin": ["/absolute/path/to/opencode-rtk"]
}
```

---

## Configuration

On first load, the plugin **automatically creates** `~/.config/opencode/rtk-wrapper-config.json` with sensible defaults. You can edit this file to customise which commands are wrapped.

**`~/.config/opencode/rtk-wrapper-config.json`**
```json
{
  "enabled": true,
  "commands": [
    "git status",
    "git diff",
    "git log",
    "ls",
    "cat",
    "rg",
    "grep",
    "find",
    "cargo",
    "docker",
    "kubectl",
    "pytest",
    "go test",
    "go build",
    "go vet",
    "vitest",
    "eslint",
    "tsc",
    "ruff",
    "pip",
    "golangci-lint",
    "prettier",
    "curl",
    "gh",
    "npm test"
  ],
  "rewriteMap": {
    "cat": "rtk read",
    "rg": "rtk grep",
    "eslint": "rtk lint"
  }
}
```

### Config reference

| Field | Type | Description |
|---|---|---|
| `enabled` | `boolean` | Global kill switch. Set to `false` to disable without uninstalling. |
| `commands` | `string[]` | Command prefixes to wrap. Uses word-boundary prefix matching (see below). |
| `rewriteMap` | `object` | Commands whose RTK name differs from the original (e.g. `cat` → `rtk read`). |

> **Config changes take effect on the next OpenCode restart.** The config is loaded once at plugin initialisation.

### Prefix matching rules

Each entry in `commands` is matched against the start of the bash command with a word boundary:

| Pattern | Command | Match? |
|---|---|---|
| `"git status"` | `git status -s` | Yes |
| `"git status"` | `git diff` | No — different subcommand |
| `"git"` | `git diff HEAD~1` | Yes |
| `"ls"` | `ls -la src/` | Yes |
| `"ls"` | `lsof` | No — no word boundary |
| `"cat"` | `cat file.txt` | Yes — rewritten via `rewriteMap` |

### Commands that are never rewritten

The plugin skips these automatically, regardless of config:

| Situation | Example |
|---|---|
| Already prefixed with `rtk` | `rtk git status` |
| Contains a pipe | `git status \| grep modified` |
| Contains `&&` or `\|\|` | `git add . && git commit -m "msg"` |
| Contains a semicolon | `cmd1; cmd2` |
| Contains a heredoc | `cat <<EOF` |
| Not in `commands[]` | `make build` |

---

## Supported RTK commands

RTK covers these command families (all available in `commands[]`):

| Command | RTK equivalent | Savings |
|---|---|---|
| `git status/diff/log/...` | `rtk git ...` | 75–92% |
| `gh pr/issue/run` | `rtk gh ...` | ~80% |
| `cargo test/build/clippy` | `rtk cargo ...` | 90–99% |
| `cat <file>` | `rtk read <file>` | 70–95% |
| `rg / grep` | `rtk grep` | 50–80% |
| `ls` | `rtk ls` | 80% |
| `find` | `rtk find` | 46–78% |
| `docker ps/images/logs` | `rtk docker ...` | 80% |
| `kubectl get/logs/services` | `rtk kubectl ...` | ~80% |
| `pytest` | `rtk pytest` | 90% |
| `go test/build/vet` | `rtk go ...` | 58–90% |
| `vitest` | `rtk vitest run` | ~90% |
| `eslint` | `rtk lint` | ~80% |
| `tsc` | `rtk tsc` | ~80% |
| `ruff` | `rtk ruff ...` | 80% |
| `pip` | `rtk pip ...` | 70–85% |
| `golangci-lint` | `rtk golangci-lint run` | 85% |
| `prettier` | `rtk prettier` | ~70% |
| `curl` | `rtk curl` | ~60% |
| `npm test` | `rtk test npm test` | ~90% |

---

## Debugging

All plugin logs are written at `debug` level under the service name `opencode-rtk`. Enable OpenCode's debug mode to see rewrite activity:

```
[opencode-rtk] RTK plugin loaded. Wrapping 25 command patterns: [git status, git diff, ...]
[opencode-rtk] RTK rewrite: "git status" -> "rtk git status"
[opencode-rtk] RTK rewrite: "cat src/main.rs" -> "rtk read src/main.rs"
```

---

## Known limitations

- **Compound commands are skipped.** `git add . && git commit -m "msg"` is not rewritten. The AI typically runs commands individually anyway.
- **No `tree` support.** RTK does not implement `tree`.
- **RTK must be in PATH.** If `rtk` is not found, the rewritten command will fail with `command not found`.
- **Config reload requires restart.** Edit the JSON then restart OpenCode to pick up changes.

---

## License

MIT
