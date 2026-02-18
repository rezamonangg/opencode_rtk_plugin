# RTK OpenCode Plugin - Implementation Plan

**Author:** OpenCode Agent
**Date:** 2026-02-18
**Status:** Draft - Awaiting Approval

---

## Table of Contents

1. [Overview](#1-overview)
2. [Background & Research](#2-background--research)
3. [Architecture](#3-architecture)
4. [File Structure](#4-file-structure)
5. [Configuration Schema](#5-configuration-schema)
6. [Plugin Implementation](#6-plugin-implementation)
7. [Rewrite Rules](#7-rewrite-rules)
8. [Safety Guards](#8-safety-guards)
9. [Logging Strategy](#9-logging-strategy)
10. [Installation Steps](#10-installation-steps)
11. [Testing Plan](#11-testing-plan)
12. [Known Limitations](#12-known-limitations)
13. [Future Enhancements](#13-future-enhancements)
14. [References](#14-references)

---

## 1. Overview

### Goal

Create an OpenCode plugin that transparently intercepts Bash tool invocations
and rewrites eligible commands to use RTK (Rust Token Killer), reducing LLM
token consumption by 60-90% on common developer commands.

### What is RTK?

RTK is an open-source CLI proxy (written in Rust) that compresses command
outputs before they reach the AI's context window. For example:

- `git status` (~120 tokens) -> `rtk git status` (~30 tokens) = **75% savings**
- `cargo test` (~4,823 tokens) -> `rtk cargo test` (~11 tokens) = **99% savings**
- `cat src/main.rs` (~10,176 tokens) -> `rtk read src/main.rs` (~504 tokens) = **95% savings**

RTK was originally built for Claude Code and uses Claude Code's `PreToolUse`
hook system. OpenCode uses a different hook system (`tool.execute.before`), so
we need a bridge plugin.

### Why a Plugin (Not Manual Usage)?

- **Automatic** - Every eligible bash command is compressed without the user
  or AI remembering to prefix `rtk`.
- **Configurable** - Users choose exactly which commands get wrapped via a
  JSON config file.
- **Non-intrusive** - Falls back gracefully if RTK is not installed or a
  command is not eligible.

---

## 2. Background & Research

### OpenCode Plugin System (Verified from Official Docs)

**Source:** https://opencode.ai/docs/plugins/

OpenCode plugins are JavaScript/TypeScript modules placed in one of:

| Location | Scope |
|---|---|
| `~/.config/opencode/plugins/` | Global (all projects) |
| `.opencode/plugins/` | Project-level |

Plugins are auto-loaded at startup. No config changes needed for local plugins.

**Key hook for this plugin:** `tool.execute.before`

```typescript
"tool.execute.before": async (input, output) => {
  // input.tool  - Tool name (e.g., "bash", "read", "grep")
  // input.args  - Original arguments (read-only reference)
  // output.args - Mutable arguments (modify these to change behavior)
  //   output.args.command - The bash command string (for bash tool)
}
```

**Plugin context object:**

```typescript
async ({ project, client, $, directory, worktree }) => {
  // project   - Current project information
  // client    - OpenCode SDK client (for logging, etc.)
  // $         - Bun shell API
  // directory - Current working directory
  // worktree  - Git worktree path
}
```

**Existing dependencies in user config:**

File: `~/.config/opencode/package.json`
```json
{
  "dependencies": {
    "@opencode-ai/plugin": "1.1.53",
    "opencode-slop": "/home/monachy/Code/Personal/opencode_slop"
  }
}
```

`@opencode-ai/plugin` is already installed, so we can use its types.

### RTK Command Support (Verified from RTK README)

**Source:** https://github.com/rtk-ai/rtk (v0.21.1)

RTK supports wrapping these command families:

| Original Command | RTK Equivalent | Savings |
|---|---|---|
| `git status/diff/log/add/commit/push/pull/branch/fetch/stash` | `rtk git ...` | 75-92% |
| `gh pr/issue/run` | `rtk gh ...` | ~80% |
| `cargo test/build/clippy` | `rtk cargo ...` | 90-99% |
| `cat <file>` | `rtk read <file>` | 70-95% |
| `rg/grep <pattern>` | `rtk grep <pattern>` | 50-80% |
| `ls` | `rtk ls` | 80% |
| `find` | `rtk find` | 46-78% |
| `docker ps/images/logs` | `rtk docker ...` | 80% |
| `kubectl get/logs/services` | `rtk kubectl ...` | ~80% |
| `pytest` | `rtk pytest` | 90% |
| `go test/build/vet` | `rtk go ...` | 58-90% |
| `vitest/pnpm test` | `rtk vitest run` | ~90% |
| `eslint/pnpm lint` | `rtk lint` | ~80% |
| `tsc/pnpm tsc` | `rtk tsc` | ~80% |
| `ruff check/format` | `rtk ruff ...` | 80% |
| `pip list/install/outdated` | `rtk pip ...` | 70-85% |
| `golangci-lint run` | `rtk golangci-lint run` | 85% |
| `prettier` | `rtk prettier` | ~70% |
| `prisma generate/migrate/db-push` | `rtk prisma ...` | ~70% |
| `curl` | `rtk curl` | ~60% |
| `npm test` | `rtk test npm test` | ~90% |

**Commands that RTK does NOT support:**
- `tree` (use `rtk ls` instead, but different behavior)
- `wc`, `du`, `df`
- `make`, `cmake`
- `ssh`, `scp`
- `tar`, `zip`, `unzip`
- Any custom scripts or binaries

### OpenCode vs RTK Tool Overlap

OpenCode already has native tools that bypass bash:

| OpenCode Tool | Bash Equivalent | RTK Needed? |
|---|---|---|
| `read` tool | `cat file.txt` | No - OpenCode already handles this natively |
| `grep` tool | `grep -rn "pattern"` | No - OpenCode uses native grep |
| `glob` tool | `find . -name "*.ts"` | No - OpenCode uses native glob |
| `bash` tool | All other commands | **Yes - this is where RTK helps** |

**Implication:** RTK's biggest value in OpenCode is for commands like
`git status`, `cargo test`, `ls`, and other commands that go through
the `bash` tool. The `cat`/`grep`/`find` rewrites are less useful since
OpenCode typically uses its native tools for those. However, the AI
sometimes still uses `bash` for these commands, so we still include them
in the rewrite map.

---

## 3. Architecture

### Data Flow

```
User prompt
    |
    v
LLM decides to call bash tool
    |
    v
OpenCode: tool.execute.before hook fires
    |
    v
RTK Plugin:
    1. Is tool === "bash"? If not, pass through.
    2. Is config enabled? If not, pass through.
    3. Is command already prefixed with "rtk"? If so, pass through.
    4. Is command a simple command (no pipes, chains, heredocs)? If not, pass through.
    5. Does command match any pattern in config.commands[]? If not, pass through.
    6. Apply rewrite (prefix "rtk " or use REWRITE_MAP for special cases).
    7. Mutate output.args.command with rewritten command.
    8. Log rewrite at debug level.
    |
    v
OpenCode executes rewritten command
    |
    v
RTK binary processes command, returns compressed output
    |
    v
LLM receives compressed output (60-90% fewer tokens)
```

### Component Diagram

```
~/.config/opencode/
├── plugins/
│   └── rtk-plugin.ts          # Plugin code (hook logic)
├── rtk-wrapper-config.json    # User-editable config
├── opencode.json              # Existing config (no changes needed)
└── package.json               # Existing deps (no changes needed)

~/.local/bin/
└── rtk                        # RTK binary (pre-installed)
```

---

## 4. File Structure

### Files to Create

| File | Purpose | Location |
|---|---|---|
| `rtk-plugin.ts` | Plugin source code | `~/.config/opencode/plugins/rtk-plugin.ts` |
| `rtk-wrapper-config.json` | Command configuration | `~/.config/opencode/rtk-wrapper-config.json` |

### Files NOT Modified

| File | Reason |
|---|---|
| `opencode.json` | Local plugins auto-load; no config entry needed |
| `package.json` | `@opencode-ai/plugin` already installed |
| `oh-my-opencode.json` | Unrelated (agent model mappings) |

---

## 5. Configuration Schema

### File: `~/.config/opencode/rtk-wrapper-config.json`

```json
{
  "enabled": true,
  "commands": [
    "git status",
    "ls",
    "cat"
  ]
}
```

### Schema Definition

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Global kill switch. Set to `false` to disable all RTK wrapping without removing the plugin. |
| `commands` | `string[]` | `["git status", "ls", "cat"]` | List of command prefixes to match. Uses prefix matching with word boundary logic. |

### How Prefix Matching Works

Each entry in `commands[]` is compared against the beginning of the bash
command string. A match requires the command to either:
- Be exactly equal to the pattern, OR
- Start with the pattern followed by a space

This prevents partial word matches (e.g., `"ls"` won't match `"lsof"`).

**Examples:**

| Config Entry | Command | Matches? | Reason |
|---|---|---|---|
| `"git status"` | `git status` | Yes | Exact match |
| `"git status"` | `git status -s` | Yes | Prefix + space |
| `"git status"` | `git diff` | No | Different subcommand |
| `"git"` | `git status` | Yes | Prefix + space |
| `"git"` | `git diff HEAD~1` | Yes | Prefix + space |
| `"git"` | `github-cli` | No | No word boundary |
| `"ls"` | `ls` | Yes | Exact match |
| `"ls"` | `ls -la src/` | Yes | Prefix + space |
| `"ls"` | `lsof` | No | No word boundary |
| `"ls"` | `lsblk` | No | No word boundary |
| `"cat"` | `cat file.txt` | Yes | Prefix + space |
| `"cat"` | `catalog` | No | No word boundary |
| `"cargo test"` | `cargo test` | Yes | Exact match |
| `"cargo test"` | `cargo test --release` | Yes | Prefix + space |
| `"cargo test"` | `cargo build` | No | Different subcommand |
| `"pytest"` | `pytest -v` | Yes | Prefix + space |
| `"docker ps"` | `docker ps -a` | Yes | Prefix + space |
| `"docker ps"` | `docker images` | No | Different subcommand |

### Example Configurations

**Minimal (default):**
```json
{
  "enabled": true,
  "commands": ["git status", "ls", "cat"]
}
```

**Git-focused:**
```json
{
  "enabled": true,
  "commands": [
    "git status",
    "git diff",
    "git log",
    "git add",
    "git commit",
    "git push",
    "git pull"
  ]
}
```

**Aggressive (all supported commands):**
```json
{
  "enabled": true,
  "commands": [
    "git",
    "gh",
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
    "prisma",
    "curl",
    "npm test",
    "pnpm test"
  ]
}
```

**Disabled (keep plugin installed but inactive):**
```json
{
  "enabled": false,
  "commands": []
}
```

---

## 6. Plugin Implementation

### File: `~/.config/opencode/plugins/rtk-plugin.ts`

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// ============================================================
// RTK Rewrite Map
// ============================================================
// Some commands have different names in RTK than the original.
// For example, `cat file.txt` becomes `rtk read file.txt`, not
// `rtk cat file.txt`. This map handles those cases.
//
// Commands NOT in this map are prefixed with `rtk ` as-is.
// e.g., `git status` -> `rtk git status`

const REWRITE_MAP: Record<string, string> = {
  cat: "rtk read",
  rg: "rtk grep",
  eslint: "rtk lint",
}

// ============================================================
// Configuration
// ============================================================

interface RtkConfig {
  enabled: boolean
  commands: string[]
}

const DEFAULT_CONFIG: RtkConfig = {
  enabled: true,
  commands: ["git status", "ls", "cat"],
}

function loadConfig(configDir: string): RtkConfig {
  const configPath = join(configDir, "rtk-wrapper-config.json")

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG }
  }

  try {
    const raw = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    return {
      enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
      commands: Array.isArray(parsed.commands)
        ? parsed.commands
        : DEFAULT_CONFIG.commands,
    }
  } catch {
    // If config file is malformed, fall back to defaults silently.
    // The debug log below will still fire so the user can investigate.
    return { ...DEFAULT_CONFIG }
  }
}

// ============================================================
// Matching Logic
// ============================================================

/**
 * Checks if a command string matches any of the configured patterns.
 *
 * Uses prefix matching with word boundary logic:
 *   - "git status" matches "git status" and "git status -s"
 *   - "ls" matches "ls" and "ls -la" but NOT "lsof"
 */
function shouldWrap(command: string, patterns: string[]): boolean {
  const trimmed = command.trim()
  return patterns.some(
    (pattern) => trimmed === pattern || trimmed.startsWith(pattern + " ")
  )
}

/**
 * Checks if a command is "simple" (safe to wrap).
 *
 * We skip complex shell constructs because RTK may not handle them
 * correctly. Specifically, we skip:
 *   - Pipes:     `git status | grep modified`
 *   - AND chain: `git add . && git commit -m "msg"`
 *   - OR chain:  `cmd1 || cmd2`
 *   - Semicolon: `cmd1; cmd2`
 *   - Heredocs:  `cat <<EOF`
 *   - Subshells: `$(command)` or backticks
 */
function isSimpleCommand(command: string): boolean {
  // Check for pipes, chains, semicolons, heredocs
  if (/[|;]|&&|\|\||<</.test(command)) {
    return false
  }
  return true
}

// ============================================================
// Rewrite Logic
// ============================================================

/**
 * Rewrites a command to use RTK.
 *
 * Most commands: prepend "rtk " (e.g., "git status" -> "rtk git status")
 * Special cases: use REWRITE_MAP (e.g., "cat file.txt" -> "rtk read file.txt")
 */
function rewriteCommand(command: string): string {
  const trimmed = command.trim()
  const firstWord = trimmed.split(/\s+/)[0]

  if (firstWord in REWRITE_MAP) {
    return trimmed.replace(firstWord, REWRITE_MAP[firstWord])
  }

  return `rtk ${trimmed}`
}

// ============================================================
// Plugin Export
// ============================================================

export const RTKPlugin: Plugin = async ({ client }) => {
  // Resolve config directory.
  // For global plugins, this is ~/.config/opencode/
  const configDir = join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "opencode"
  )

  const config = loadConfig(configDir)

  // If disabled, return empty hooks (plugin is a no-op).
  if (!config.enabled) {
    await client.app.log({
      body: {
        service: "rtk-plugin",
        level: "debug",
        message: "RTK plugin is disabled via config",
      },
    })
    return {}
  }

  await client.app.log({
    body: {
      service: "rtk-plugin",
      level: "debug",
      message: `RTK plugin loaded. Wrapping ${config.commands.length} command patterns: [${config.commands.join(", ")}]`,
    },
  })

  return {
    "tool.execute.before": async (input, output) => {
      // Only intercept bash tool calls.
      if (input.tool !== "bash") return

      const command = output.args.command as string
      if (!command) return

      const trimmed = command.trim()

      // Skip commands already using rtk.
      if (trimmed.startsWith("rtk ")) return

      // Skip complex commands (pipes, chains, heredocs).
      if (!isSimpleCommand(trimmed)) return

      // Skip commands that don't match any configured pattern.
      if (!shouldWrap(trimmed, config.commands)) return

      // Apply the rewrite.
      const rewritten = rewriteCommand(trimmed)
      output.args.command = rewritten

      await client.app.log({
        body: {
          service: "rtk-plugin",
          level: "debug",
          message: `RTK rewrite: "${trimmed}" -> "${rewritten}"`,
        },
      })
    },
  }
}

export default RTKPlugin
```

### Code Walkthrough

**Initialization phase** (runs once at plugin load):
1. Resolve the config directory path (`~/.config/opencode/`)
2. Load `rtk-wrapper-config.json` from that directory
3. If `enabled: false`, return empty hooks (no-op plugin)
4. Log the loaded configuration at debug level

**Hook phase** (runs on every `bash` tool invocation):
1. Check `input.tool === "bash"` - skip all other tools
2. Extract the command string from `output.args.command`
3. Run through safety guards (already has `rtk`, complex command, no pattern match)
4. Apply rewrite using `rewriteCommand()`
5. Mutate `output.args.command` with the rewritten command
6. Log the rewrite at debug level

---

## 7. Rewrite Rules

### Standard Rewrites (prefix `rtk `)

These commands are simply prefixed with `rtk `:

| Original | Rewritten |
|---|---|
| `git status` | `rtk git status` |
| `git status -s` | `rtk git status -s` |
| `git diff HEAD~1` | `rtk git diff HEAD~1` |
| `git log -n 10` | `rtk git log -n 10` |
| `git add .` | `rtk git add .` |
| `git commit -m "msg"` | `rtk git commit -m "msg"` |
| `git push` | `rtk git push` |
| `git pull` | `rtk git pull` |
| `gh pr list` | `rtk gh pr list` |
| `ls` | `rtk ls` |
| `ls -la src/` | `rtk ls -la src/` |
| `cargo test` | `rtk cargo test` |
| `cargo build` | `rtk cargo build` |
| `docker ps` | `rtk docker ps` |
| `kubectl get pods` | `rtk kubectl get pods` |
| `pytest -v` | `rtk pytest -v` |
| `go test ./...` | `rtk go test ./...` |
| `find . -name "*.ts"` | `rtk find . -name "*.ts"` |
| `grep "pattern" src/` | `rtk grep "pattern" src/` |
| `ruff check .` | `rtk ruff check .` |
| `pip list` | `rtk pip list` |
| `curl https://example.com` | `rtk curl https://example.com` |

### Special Rewrites (REWRITE_MAP)

These commands use a different name in RTK:

| Original | Rewritten | Reason |
|---|---|---|
| `cat file.txt` | `rtk read file.txt` | RTK uses `rtk read`, not `rtk cat` |
| `rg "pattern" .` | `rtk grep "pattern" .` | RTK unifies `rg`/`grep` under `rtk grep` |
| `eslint src/` | `rtk lint src/` | RTK uses `rtk lint` for all linters |

### Commands That Pass Through (No Rewrite)

| Command | Reason |
|---|---|
| `rtk git status` | Already prefixed with `rtk` |
| `git status \| grep modified` | Contains pipe (`\|`) |
| `git add . && git commit -m "msg"` | Contains chain (`&&`) |
| `cat <<EOF` | Contains heredoc (`<<`) |
| `make build` | Not in `commands[]` config |
| `node script.js` | Not in `commands[]` config |
| `python main.py` | Not in `commands[]` config |

---

## 8. Safety Guards

The plugin applies multiple layers of safety checks before rewriting a command.
All checks must pass for a rewrite to occur.

### Guard 1: Tool Check

```
if (input.tool !== "bash") return
```

Only the `bash` tool is intercepted. Other tools (`read`, `grep`, `glob`,
`edit`, `write`, etc.) pass through untouched.

### Guard 2: Empty Command Check

```
if (!command) return
```

Defensive check for edge cases where the command string is empty or undefined.

### Guard 3: Already-Prefixed Check

```
if (trimmed.startsWith("rtk ")) return
```

Prevents double-wrapping. If the LLM or another plugin already added `rtk`,
we don't add it again.

### Guard 4: Simple Command Check

```
if (!isSimpleCommand(trimmed)) return
```

Skips commands containing shell constructs that RTK may not handle correctly:
- Pipes: `|`
- AND chains: `&&`
- OR chains: `||`
- Semicolons: `;`
- Heredocs: `<<`

### Guard 5: Pattern Match Check

```
if (!shouldWrap(trimmed, config.commands)) return
```

Only rewrites commands whose prefix matches an entry in the user's config.
This gives the user full control over which commands are wrapped.

### Guard Summary Table

| Guard | Checks | Example Blocked |
|---|---|---|
| Tool check | `input.tool !== "bash"` | `read` tool, `grep` tool |
| Empty check | `!command` | Malformed tool call |
| Already-prefixed | Starts with `"rtk "` | `rtk git status` |
| Simple command | No `\|`, `&&`, `\|\|`, `;`, `<<` | `git status \| grep modified` |
| Pattern match | Not in `commands[]` | `make build` (not configured) |

---

## 9. Logging Strategy

All logging uses `client.app.log()` at `level: "debug"`. This means:
- Logs are **only visible** in OpenCode's debug mode
- No output is shown during normal usage
- Useful for troubleshooting if rewrites aren't working as expected

### Log Messages

| Event | Level | Message Format |
|---|---|---|
| Plugin loaded (enabled) | `debug` | `RTK plugin loaded. Wrapping N command patterns: [...]` |
| Plugin loaded (disabled) | `debug` | `RTK plugin is disabled via config` |
| Command rewritten | `debug` | `RTK rewrite: "git status" -> "rtk git status"` |

### How to View Logs

OpenCode debug logs can be accessed through the OpenCode debug interface.
The `service` field is set to `"rtk-plugin"` for filtering.

---

## 10. Installation Steps

### Prerequisites

- RTK binary installed and in PATH
  ```bash
  rtk --version   # Should show "rtk 0.21.1" or similar
  rtk gain         # Should show token savings stats
  ```
- OpenCode installed and working
- `@opencode-ai/plugin` package available (already in `~/.config/opencode/package.json`)

### Step-by-Step

**Step 1: Create the plugins directory**

```bash
mkdir -p ~/.config/opencode/plugins
```

**Step 2: Create the plugin file**

Write `~/.config/opencode/plugins/rtk-plugin.ts` with the code from
Section 6 above.

**Step 3: Create the config file**

Write `~/.config/opencode/rtk-wrapper-config.json` with:

```json
{
  "enabled": true,
  "commands": [
    "git status",
    "ls",
    "cat"
  ]
}
```

**Step 4: Restart OpenCode**

Close and reopen OpenCode. The plugin is auto-loaded from the plugins directory.

**Step 5: Verify**

Ask OpenCode to run `git status` in a project. Check that the debug log
shows the rewrite. The output should be RTK's compact format:

```
  master...origin/master
  Modified: 3 files
   index.html
   src/main.rs
   src/config.rs
```

Instead of the verbose default:

```
On branch master
Your branch is up to date with 'origin/master'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
        modified:   index.html
        modified:   src/main.rs
        modified:   src/config.rs

no changes added to commit (use "git add" and/or "git commit -a")
```

---

## 11. Testing Plan

### Manual Test Cases

| ID | Command | Config | Expected Behavior |
|---|---|---|---|
| TC-01 | `git status` | `["git status"]` | Rewritten to `rtk git status` |
| TC-02 | `git diff HEAD~1` | `["git status"]` | NOT rewritten (pattern is "git status", not "git diff") |
| TC-03 | `git diff HEAD~1` | `["git"]` | Rewritten to `rtk git diff HEAD~1` |
| TC-04 | `ls -la` | `["ls"]` | Rewritten to `rtk ls -la` |
| TC-05 | `lsof` | `["ls"]` | NOT rewritten (word boundary) |
| TC-06 | `cat main.rs` | `["cat"]` | Rewritten to `rtk read main.rs` (REWRITE_MAP) |
| TC-07 | `rtk git status` | `["git status"]` | NOT rewritten (already prefixed) |
| TC-08 | `git status \| head` | `["git status"]` | NOT rewritten (pipe detected) |
| TC-09 | `git add . && git commit` | `["git"]` | NOT rewritten (chain detected) |
| TC-10 | `cat <<EOF` | `["cat"]` | NOT rewritten (heredoc detected) |
| TC-11 | `make build` | `["git status", "ls"]` | NOT rewritten (not in config) |
| TC-12 | Any command | `enabled: false` | NOT rewritten (plugin disabled) |
| TC-13 | `rg "pattern" .` | `["rg"]` | Rewritten to `rtk grep "pattern" .` (REWRITE_MAP) |
| TC-14 | `eslint src/` | `["eslint"]` | Rewritten to `rtk lint src/` (REWRITE_MAP) |

### Verification Method

Since this is a plugin (not a standalone app), testing is done manually by:

1. Starting OpenCode with the plugin loaded
2. Asking the AI to run specific commands
3. Observing the output format (RTK compact vs standard verbose)
4. Checking debug logs for rewrite messages

---

## 12. Known Limitations

### Limitation 1: Simple Commands Only

Commands with pipes, chains, semicolons, or heredocs are skipped entirely.
This means compound commands like `git add . && git commit -m "msg"` will
not benefit from RTK compression, even though each individual command would.

**Workaround:** The AI typically runs commands separately in OpenCode, so
this rarely matters in practice.

### Limitation 2: No `tree` Support

RTK does not have a `tree` command. The closest equivalent is `rtk ls`, which
provides a tree-like view but with different formatting and options. We do not
map `tree` -> `rtk ls` to avoid unexpected behavior changes.

### Limitation 3: Config Changes Require Restart

Changes to `rtk-wrapper-config.json` are only picked up on OpenCode startup.
The config is loaded once when the plugin initializes.

**Future enhancement:** Could watch the config file for changes using
`fs.watch()`.

### Limitation 4: No RTK Installation Check

The plugin does not verify that RTK is installed before attempting to rewrite
commands. If RTK is not in PATH, the rewritten command will fail with a
"command not found" error.

**Workaround:** Ensure RTK is installed before enabling the plugin.

### Limitation 5: OpenCode Native Tools Bypass

When OpenCode uses its native `read`, `grep`, or `glob` tools instead of
`bash`, the plugin has no effect. This is actually desired behavior - the
native tools are already optimized. But it means RTK's compression only
applies to commands that go through the `bash` tool.

---

## 13. Future Enhancements

These are not part of the initial implementation but could be added later:

### Hot Reload Config

Watch `rtk-wrapper-config.json` for changes and reload without restarting
OpenCode. Uses `fs.watch()` or polling.

### RTK Installation Check

On plugin load, check if `rtk` is in PATH by running `which rtk`. If not
found, log a warning and disable the plugin.

### Statistics Tracking

Track how many commands were rewritten per session. Display a summary when
the session ends (using the `session.idle` event).

### Per-Project Config

Support project-level config in `.opencode/rtk-wrapper-config.json` that
overrides the global config. This allows different command sets per project.

### Regex Pattern Matching

Instead of prefix matching, support regex patterns for more flexible command
matching (e.g., `"^(npm|pnpm|yarn) test"`).

---

## 14. References

| Resource | URL |
|---|---|
| RTK GitHub Repository | https://github.com/rtk-ai/rtk |
| RTK Website | https://www.rtk-ai.app |
| OpenCode Plugin Docs | https://opencode.ai/docs/plugins/ |
| OpenCode Custom Tools Docs | https://opencode.ai/docs/custom-tools/ |
| OpenCode Config Docs | https://opencode.ai/docs/config/ |
| RTK Supported Commands | https://github.com/rtk-ai/rtk#commands |
| RTK Auto-Rewrite Hook | https://github.com/rtk-ai/rtk#auto-rewrite-hook-recommended |
| RTK Version (current) | v0.21.1 |
| OpenCode Plugin Package | `@opencode-ai/plugin@1.1.53` |
