# Design: Session-Based RTK Stats

**Date:** 2026-02-23
**Status:** Approved
**Goal:** Show per-session command breakdown with estimated token savings

---

## Overview

Currently, `/rtk-gain` shows global RTK stats from `rtk gain` CLI. We want to show session-scoped stats with per-command token savings estimates.

### Current Behavior
```
RTK Token Savings (12m)

RTK Session Stats:
- 150 commands executed
- 28.0K input tokens, 15.1K output tokens
- 13.0K tokens saved (46.6%)
```

### New Behavior
```
📊 RTK Session Stats (12m)
⚠️ Token savings are estimated per-session. If running multiple OpenCode instances simultaneously, totals may include savings from other sessions.

Commands Rewritten:
  git status    — 5 calls, ~250 tokens saved
  ls            — 3 calls, ~90 tokens saved
  cat           — 2 calls, ~40 tokens saved

Total: 10 commands, ~380 tokens saved
```

---

## Technical Design

### 1. Updated Types

```typescript
interface CommandStats {
  count: number
  tokensSaved: number
}

interface SessionStats {
  commands: Record<string, CommandStats>
  startedAt: Date
}
```

### 2. RTK Gain Parser

Parse output format:
```
RTK Session Stats:
- 150 commands executed
- 28.0K input tokens, 15.1K output tokens
- 13.0K tokens saved (46.6%)
```

```typescript
function parseRtkGainTokens(output: string): number {
  const match = output.match(/(\d+\.?\d*)K?\s*tokens saved/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const isK = output.includes(match[1] + "K")
  return isK ? Math.round(value * 1000) : Math.round(value)
}
```

### 3. Before/After Token Tracking

Store baseline in module scope, calculate delta in `tool.execute.after`.

```typescript
let pendingCommand: { cmdKey: string; baseline: number } | null = null

"tool.execute.before": async (input, output) => {
  // Get baseline
  try {
    const baseline = parseRtkGainTokens(execSync("rtk gain", ...))
    pendingCommand = { cmdKey, baseline }
  } catch {
    pendingCommand = { cmdKey, baseline: 0 }
  }
  
  // Rewrite command
  output.args.command = rewritten
  
  // Track count
  sessionStats.commands[cmdKey] = { count: 0, tokensSaved: 0 }
  sessionStats.commands[cmdKey].count++
}

"tool.execute.after": async (input, output) => {
  if (!pendingCommand) return
  
  try {
    const current = parseRtkGainTokens(execSync("rtk gain", ...))
    const delta = current - pendingCommand.baseline
    
    if (delta > 0) {
      sessionStats.commands[pendingCommand.cmdKey].tokensSaved += delta
    }
  } catch {
    // Ignore - tokensSaved stays at 0
  }
  
  pendingCommand = null
}
```

### 4. Updated Formatter

```typescript
function formatSessionStats(stats: SessionStats): string {
  // ... duration calculation ...
  
  const disclaimer = "⚠️ Token savings are estimated per-session. " +
    "If running multiple OpenCode instances simultaneously, " +
    "totals may include savings from other sessions."
  
  // Show per-command breakdown with tokens
  // Show totals at bottom
}
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| `rtk gain` not installed | tokensSaved stays 0, show count only |
| `rtk gain` timeout | Same as above |
| Negative delta (race condition) | Ignore (don't subtract) |
| Concurrent sessions | Disclaimer informs user |
