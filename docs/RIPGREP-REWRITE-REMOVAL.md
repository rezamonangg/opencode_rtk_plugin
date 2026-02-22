# Remove Ripgrep from RewriteMap

**Status:** Complete
**Priority:** Medium
**Created:** 2026-02-23
**Completed:** 2026-02-23

---

## Problem Statement

`rg` and `grep` commands are being rewritten to `rtk grep`, but the CLI argument ordering is incompatible:

| Tool | Argument Order |
|------|---------------|
| `rg` / `grep` | `[FLAGS] <PATTERN> [PATH]` |
| `rtk grep` | `[OPTIONS] <PATTERN> [PATH] [EXTRA_ARGS]...` |

This causes commands like `rg -rn "pattern" src/` to fail when rewritten to `rtk grep -rn "pattern" src/`.

### Error Example

```
$ rtk grep -rn "/home" /path/
error: unexpected argument '-r' found
  tip: to pass '-r' as a value, use '-- -r'
```

---

## Decision

Remove `rg` from the `rewriteMap` to prevent broken rewrites.

**Rationale:**
1. **CLI incompatibility** — Flag ordering differs between `rg` and `rtk grep`
2. **Complexity vs value** — Correctly repositioning all ripgrep flags (`-C`, `--glob`, `-e`, etc.) is non-trivial
3. **Limited savings** — Grep output is already compact; savings are marginal
4. **Debug cost** — One broken command wastes more tokens than the savings provide

---

## Implementation Plan

### File: `src/index.ts`

#### Change 1: Update `DEFAULT_CONFIG.rewriteMap`

**Location:** Lines 98-102

**Before:**
```typescript
rewriteMap: {
  cat: "rtk read",
  rg: "rtk grep",
  eslint: "rtk lint",
},
```

**After:**
```typescript
rewriteMap: {
  cat: "rtk read",
  eslint: "rtk lint",
},
```

#### Change 2: Update `DEFAULT_CONFIG.commands` (Optional)

Keep `rg` and `grep` in the commands list for stats tracking, OR remove them entirely.

**Recommendation:** Keep them. This allows tracking how often grep commands are issued even though they're not rewritten.

---

## Verification

1. Build: `bun run build`
2. Typecheck: `bun run typecheck`
3. Manual test:
   ```bash
   # Should NOT be rewritten
   rg -rn "pattern" src/
   
   # Should still be rewritten
   cat file.txt
   ```

---

## Impact

| Aspect | Before | After |
|--------|--------|-------|
| `rg` commands | Rewritten to `rtk grep` | Passed through unchanged |
| `grep` commands | Rewritten to `rtk grep` | Passed through unchanged |
| `cat` commands | Rewritten to `rtk read` | Rewritten to `rtk read` (unchanged) |
| Token savings | Higher (but some broken) | Lower (but reliable) |

---

## Future Considerations

If `rtk grep` is updated to accept flags before the pattern (matching `rg` behavior), this can be reconsidered. Track upstream issue if one exists.

---

## Changelog

- **2026-02-23:** Plan created
- **2026-02-23:** Implemented - removed `rg: "rtk grep"` from rewriteMap in:
  - `src/index.ts`
  - `rtk-wrapper-config.example.json`
  - `README.md` (updated savings table)
