# Directory Naming Update Plan

**Author:** OpenCode Agent
**Date:** 2026-02-22
**Status:** Draft — Awaiting Approval

---

## Background

OpenCode has changed its configuration directory naming convention from plural to singular:

| Old (Plural) | New (Singular) |
|--------------|----------------|
| `~/.config/opencode/commands/` | `~/.config/opencode/command/` |
| `~/.config/opencode/plugins/` | `~/.config/opencode/plugin/` |
| `~/.config/opencode/skills/` | `~/.config/opencode/skill/` |

The `plugin` key in `opencode.json` remains unchanged (already singular).

---

## Changes Required

### 1. Code Changes

| File | Line | Current | Change To |
|------|------|---------|-----------|
| `src/index.ts` | 211 | `join(configDir, "commands")` | `join(configDir, "command")` |

**Details:**
- The `commandsDir` variable is used to auto-create the `/rtk-gain` slash command file
- Only affects the directory path where the command markdown file is created

### 2. Documentation Changes

#### `docs/PLAN.md`

| Line(s) | Current | Change To |
|---------|---------|-----------|
| 70 | `\| ~/.config/opencode/plugins/ \| Global (all projects) \|` | `\| ~/.config/opencode/plugin/ \| Global (all projects) \|` |
| 71 | `\| .opencode/plugins/ \| Project-level \|` | `\| .opencode/plugin/ \| Project-level \|` |
| 208 | `plugins/` | `plugin/` |
| 209 | `rtk-plugin.ts          # Plugin code (hook logic)` | (same, just directory name changes) |
| 226 | `\| rtk-plugin.ts \| Plugin source code \| ~/.config/opencode/plugins/rtk-plugin.ts \|` | `\| rtk-plugin.ts \| Plugin source code \| ~/.config/opencode/plugin/rtk-plugin.ts \|` |
| 365 | `### File: ~/.config/opencode/plugins/rtk-plugin.ts` | `### File: ~/.config/opencode/plugin/rtk-plugin.ts` |

#### `docs/RTK-GAIN-PLAN.md`

| Line(s) | Current | Change To |
|---------|---------|-----------|
| 44 | `\| ~/.config/opencode/commands/ \| Global \|` | `\| ~/.config/opencode/command/ \| Global \|` |
| 45 | `\| .opencode/commands/ \| Project-level \|` | `\| .opencode/command/ \| Project-level \|` |
| 271 | `const commandsDir = join(configDir, "commands")` | `const commandsDir = join(configDir, "command")` |
| 351 | `### File: ~/.config/opencode/commands/rtk-gain.md` | `### File: ~/.config/opencode/command/rtk-gain.md` |
| 375 | `Plugin loads, ~/.config/opencode/commands/rtk-gain.md doesn't exist` | `Plugin loads, ~/.config/opencode/command/rtk-gain.md doesn't exist` |
| 433 | `If the user already has a ~/.config/opencode/commands/rtk-gain.md` | `If the user already has a ~/.config/opencode/command/rtk-gain.md` |

#### `docs/NPM-PUBLISH-PLAN.md`

No directory path references found. No changes needed.

#### `README.md`

No direct directory path references (uses `~/.config/opencode/` without subdirectory specifics). No changes needed.

#### `AGENTS.md`

No direct directory path references. No changes needed.

---

## Summary

| File | Changes |
|------|---------|
| `src/index.ts` | 1 line (code) |
| `docs/PLAN.md` | ~5 lines (documentation) |
| `docs/RTK-GAIN-PLAN.md` | ~5 lines (documentation) |

**Total:** ~11 lines across 3 files

---

## Verification

After changes:

```bash
# Build must pass
bun run build

# Typecheck must pass
bun run typecheck
```

---

## Implementation Order

1. Update `src/index.ts` (code change)
2. Update `docs/PLAN.md` (documentation)
3. Update `docs/RTK-GAIN-PLAN.md` (documentation)
4. Run verification commands
