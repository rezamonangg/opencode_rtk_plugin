# `/rtk-gain` Slash Command — Implementation Plan

**Author:** OpenCode Agent
**Date:** 2026-02-18
**Status:** Draft — Awaiting Approval
**Depends on:** `docs/PLAN.md` (base plugin, already implemented)

---

## Table of Contents

1. [Goal](#1-goal)
2. [Research](#2-research)
3. [Architecture](#3-architecture)
4. [Implementation Details](#4-implementation-details)
5. [Output Format](#5-output-format)
6. [Changes to Existing Code](#6-changes-to-existing-code)
7. [New Files](#7-new-files)
8. [Testing Plan](#8-testing-plan)
9. [Known Limitations](#9-known-limitations)

---

## 1. Goal

Add a `/rtk-gain` slash command that shows **session-scoped** RTK rewrite
statistics — how many bash commands were rewritten, broken down by command.

This is purely in-memory tracking. Stats reset when OpenCode restarts
(which is also when the plugin reloads). No files, no persistence.

---

## 2. Research

### How OpenCode Slash Commands Work

**Source:** https://opencode.ai/docs/commands/

Slash commands are **prompt templates** stored as markdown files in:

| Location | Scope |
|---|---|
| `~/.config/opencode/commands/` | Global |
| `.opencode/commands/` | Project-level |

The markdown filename becomes the command name. Running `/rtk-gain` sends
the file's body to the LLM as a prompt.

**Frontmatter options:**

```yaml
---
description: Short text shown in TUI autocomplete
agent: optional-agent-name
model: optional-model-override
subtask: true/false
---
```

**Key limitation:** Slash commands can only send prompts. They cannot
directly execute code or read variables. However, they can instruct the
LLM to call a custom tool.

### How OpenCode Custom Tools Work

**Source:** https://opencode.ai/docs/custom-tools/

Plugins can register custom tools the LLM can call. The plugin docs
(https://opencode.ai/docs/plugins/) show that the return object from
a plugin function can include a `tool` key:

```typescript
import { tool } from "@opencode-ai/plugin"

return {
  tool: {
    mytool: tool({
      description: "This is a custom tool",
      args: { foo: tool.schema.string() },
      async execute(args, context) {
        return `Hello ${args.foo}`
      },
    }),
  },
}
```

The tool name is the key under `tool` (e.g., `mytool` above). The LLM
can call it like any built-in tool.

### Linking the Two: Command → Tool

The slash command's markdown body instructs the LLM to call the custom
tool. This is the bridge pattern:

1. User types `/rtk-gain`
2. OpenCode sends the command's markdown body as a prompt
3. The prompt says "Call the `rtk_gain` tool"
4. LLM calls the `rtk_gain` custom tool registered by the plugin
5. Tool returns formatted session stats
6. LLM presents the result to the user

---

## 3. Architecture

### Data Flow

```
User types /rtk-gain
    │
    ▼
OpenCode sends command prompt to LLM
    │
    ▼
LLM sees: "Call the rtk_gain tool to display
           RTK rewrite statistics for the
           current session."
    │
    ▼
LLM calls rtk_gain tool (no arguments)
    │
    ▼
Plugin reads in-memory sessionStats object
    │
    ▼
Returns formatted text:
    "Session: 42m │ Rewrites: 17
     git status — 8
     ls         — 5
     cat        — 4"
    │
    ▼
LLM presents stats to user
```

### Session Stats Lifecycle

```
OpenCode starts
    │
    ▼
Plugin loads → sessionStats = { rewriteCount: 0, commands: {}, startedAt: now }
    │
    ▼
User works... bash commands get rewritten
    │
    ▼
Each rewrite increments sessionStats.rewriteCount
and sessionStats.commands["git status"]++
    │
    ▼
User types /rtk-gain → tool reads sessionStats → formatted output
    │
    ▼
OpenCode exits → sessionStats is garbage collected (no persistence)
```

---

## 4. Implementation Details

### 4.1. Session Stats Object

Added at **module scope** inside `src/index.ts`, outside the plugin
function. This ensures it persists for the lifetime of the plugin
(= the OpenCode session) but resets on restart.

```typescript
interface SessionStats {
  rewriteCount: number
  commands: Record<string, number>
  startedAt: Date
}

const sessionStats: SessionStats = {
  rewriteCount: 0,
  commands: {},
  startedAt: new Date(),
}
```

### 4.2. Tracking in the Hook

In the existing `tool.execute.before` handler, after the rewrite is
applied (`output.args.command = rewritten`), add:

```typescript
// Track the rewrite for /rtk-gain stats.
sessionStats.rewriteCount++
// Use up to the first 2 words as the key (e.g., "git status", "ls", "cargo test").
const words = trimmed.split(/\s+/)
const cmdKey = words.length >= 2 ? `${words[0]} ${words[1]}` : words[0]
sessionStats.commands[cmdKey] = (sessionStats.commands[cmdKey] ?? 0) + 1
```

**Why first 2 words?** To group `git status -s` and `git status` under
one key (`git status`), but keep `git diff` and `git log` separate.
Single-word commands like `ls` or `pytest` use just the first word.

### 4.3. Custom Tool Registration

The plugin return object adds a `tool` key alongside the existing
`tool.execute.before` hook:

```typescript
import { tool } from "@opencode-ai/plugin"

return {
  tool: {
    rtk_gain: tool({
      description:
        "Show RTK rewrite statistics for the current OpenCode session. " +
        "Returns a count of how many bash commands were rewritten to use RTK, " +
        "broken down by command.",
      args: {},
      async execute() {
        return formatSessionStats(sessionStats)
      },
    }),
  },
  "tool.execute.before": async (input, output) => {
    // ... existing rewrite logic with stats tracking ...
  },
}
```

### 4.4. Formatting Function

```typescript
function formatSessionStats(stats: SessionStats): string {
  const elapsed = Date.now() - stats.startedAt.getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(minutes / 60)
  const duration =
    hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`

  if (stats.rewriteCount === 0) {
    return `RTK Session Stats (${duration})\nNo commands rewritten yet.`
  }

  // Sort commands by count descending.
  const sorted = Object.entries(stats.commands).sort(
    ([, a], [, b]) => b - a
  )

  const maxCmdLen = Math.max(...sorted.map(([cmd]) => cmd.length))

  const lines = sorted.map(
    ([cmd, count]) =>
      `  ${cmd.padEnd(maxCmdLen)}  — ${count} rewrite${count !== 1 ? "s" : ""}`
  )

  return [
    `RTK Session Stats (${duration})`,
    `Total rewrites: ${stats.rewriteCount}`,
    "",
    ...lines,
  ].join("\n")
}
```

### 4.5. Auto-Create Command File

During plugin initialisation (inside the `RTKPlugin` function, after
loading config), create the slash command markdown file if it doesn't
exist:

```typescript
const commandsDir = join(configDir, "commands")
const commandPath = join(commandsDir, "rtk-gain.md")

if (!existsSync(commandPath)) {
  try {
    mkdirSync(commandsDir, { recursive: true })
    writeFileSync(
      commandPath,
      [
        "---",
        "description: Show RTK token savings for this session",
        "---",
        "Call the rtk_gain tool to display RTK rewrite statistics for the current session.",
      ].join("\n"),
      "utf-8"
    )
  } catch {
    // Non-fatal — user can create the file manually.
  }
}
```

**Why auto-create?** So the `/rtk-gain` command works immediately after
installing the plugin, without any manual setup. The file is only
written once (if it doesn't already exist), so user edits are preserved.

---

## 5. Output Format

### Example: After some usage

```
RTK Session Stats (42m)
Total rewrites: 17

  git status  — 8 rewrites
  ls          — 5 rewrites
  cat         — 4 rewrites
```

### Example: No rewrites yet

```
RTK Session Stats (2m)
No commands rewritten yet.
```

---

## 6. Changes to Existing Code

### File: `src/index.ts`

| Section | Change | Lines Affected |
|---|---|---|
| Imports | Add `import { tool } from "@opencode-ai/plugin"` | Line 1 |
| Module scope | Add `SessionStats` interface and `sessionStats` const | New block after line 3 |
| `loadOrCreateConfig` | No changes | — |
| `shouldWrap` / `isSimpleCommand` / `rewriteCommand` | No changes | — |
| Plugin init | Add command file auto-creation after config load | After line 143 |
| Plugin return | Add `tool: { rtk_gain: ... }` alongside existing hook | Lines 164–188 |
| `tool.execute.before` hook | Add 3 lines for stats tracking after `output.args.command = rewritten` | After line 178 |
| New function | Add `formatSessionStats()` | New block |

**Total diff estimate:** ~60 lines added, 0 lines removed, 0 lines modified.

### File: `README.md`

Add a new section after "Debugging" documenting:
- The `/rtk-gain` command
- Example output
- Note that stats are session-scoped

**Estimate:** ~20 lines added.

---

## 7. New Files

### File: `~/.config/opencode/commands/rtk-gain.md` (auto-created at runtime)

```markdown
---
description: Show RTK token savings for this session
---
Call the rtk_gain tool to display RTK rewrite statistics for the current session.
```

This file is **not** part of the npm package. It is created by the
plugin on first load if it doesn't already exist.

---

## 8. Testing Plan

### Test Cases

| ID | Scenario | Expected |
|---|---|---|
| TC-01 | `/rtk-gain` with no rewrites this session | Shows "No commands rewritten yet." with session duration |
| TC-02 | `/rtk-gain` after 3 `git status` rewrites | Shows `git status — 3 rewrites` |
| TC-03 | `/rtk-gain` after mixed commands (`git status` x2, `ls` x1, `cat` x3) | Shows all 3 commands sorted by count descending |
| TC-04 | `rtk_gain` tool called directly by LLM (without slash command) | Works — returns same formatted stats |
| TC-05 | Plugin loads, `~/.config/opencode/commands/rtk-gain.md` doesn't exist | File is auto-created |
| TC-06 | Plugin loads, `rtk-gain.md` already exists (user customized it) | File is NOT overwritten |
| TC-07 | Plugin disabled (`enabled: false`) | `/rtk-gain` command file is NOT created, `rtk_gain` tool is NOT registered |
| TC-08 | Restart OpenCode, run `/rtk-gain` | Stats reset to 0 (session-scoped) |
| TC-09 | Commands dir doesn't exist and can't be created (permissions) | Plugin continues without slash command |

### Verification Method

1. Start OpenCode with the plugin loaded
2. Run several commands that trigger rewrites (e.g., `git status`, `ls`)
3. Type `/rtk-gain` in the TUI
4. Verify the output shows correct counts
5. Restart OpenCode, verify counts reset

### Build Verification

```bash
bun run typecheck   # Must pass with no errors
bun run build       # Must produce dist/index.js
```

---

## 9. Known Limitations

### No Token Count Estimation

We track **rewrite count** (how many commands were rewritten), not
**token savings** (how many tokens were saved). Estimating actual token
savings would require measuring the output size with and without RTK,
which is not feasible from a `tool.execute.before` hook (we don't see
the command's output).

**Possible future enhancement:** Use `tool.execute.after` to measure
output size of rewritten vs non-rewritten commands and estimate savings.

### Command Key Granularity

The stats key uses the first 2 words of the original command. This means
`git status -s` and `git status --porcelain` are grouped under
`git status`. This is usually desirable but may hide differences in
some edge cases.

### LLM Dependency

The `/rtk-gain` slash command relies on the LLM correctly interpreting
the instruction to call the `rtk_gain` tool. This should work reliably
since:
- The prompt is direct and unambiguous
- The tool name matches the command name
- The tool has a clear description

However, if the LLM decides to respond without calling the tool, the
user won't see stats. This is an inherent limitation of the
command → tool bridge pattern.

### Command File Conflicts

If the user already has a `~/.config/opencode/commands/rtk-gain.md` for
a different purpose, the plugin will not overwrite it (existence check
prevents this). But the file would need to reference `rtk_gain` for
the feature to work.
