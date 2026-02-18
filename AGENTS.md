# AGENTS.md

Guidelines for AI agents working on the opencode-rtk plugin.

---

## Build & Development

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun run build` | Build plugin + CLI with type declarations |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run prepublishOnly` | Build before publishing |

**Note:** No test runner configured. Add tests via `bun:test` if needed.

---

## Project Structure

```
src/
├── index.ts    # Main plugin export (Bun target)
└── cli.ts      # CLI installer tool (Node target)
dist/           # Compiled output + declarations
```

- Plugin: ESM, targets Bun runtime
- CLI: ESM, targets Node runtime for npx/bunx compatibility

---

## Code Style

### TypeScript
- **Module**: ESM (`"type": "module"`)
- **Target**: ES2022
- **Strict mode**: Enabled
- **Quotes**: Double (`"`)
- **Semicolons**: Required

### Naming
- `PascalCase`: Interfaces, types (`RtkConfig`, `SessionStats`)
- `camelCase`: Functions, variables, constants (`rewriteCommand`, `configDir`)
- `UPPER_SNAKE_CASE`: Top-level constants only (`DEFAULT_CONFIG`)

### Imports
Order: 1) external types, 2) external modules, 3) internal
```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { join } from "path"
```

### Error Handling
Use try/catch with silent fallbacks for non-critical operations:
```typescript
try {
  writeFileSync(path, data)
} catch {
  // Silent fallback - operation is non-critical
}
```

For critical errors, log and exit with process.exit(1).

### Type Safety
- Always use explicit return types on exported functions
- Use `type` imports for types (`import type { Plugin }`)
- Prefer `??` over `||` for nullish coalescing
- Use `const` assertions for literal types when needed

---

## Configuration

Plugin auto-generates config at `~/.config/opencode/rtk-wrapper-config.json`:
```json
{
  "enabled": true,
  "commands": ["git status", "ls", ...],
  "rewriteMap": { "cat": "rtk read" }
}
```

Config directory from env: `OPENCODE_CONFIG_DIR`

---

## Testing Strategy

Currently no tests. If adding:
1. Use `bun:test` (built-in)
2. Mock `fs` and `@opencode-ai/plugin`
3. Test rewrite logic: `shouldWrap()`, `rewriteCommand()`, `isSimpleCommand()`
4. Test config loading edge cases (malformed JSON, missing files)

---

## Key Implementation Notes

- Plugin hooks into `tool.execute.before` to rewrite bash commands
- Only simple commands (no pipes/chains) are wrapped
- Uses word-boundary prefix matching for command patterns
- Session stats tracked in module-scope (resets on reload)
- Creates `/rtk-gain` slash command on first load

---

## Publishing

Package: `@rezamonangg/opencode-rtk`

### Release Workflow (npm + GitHub)

```bash
# 1. Commit all changes
git add -A
git commit -m "feat: description of changes"

# 2. Bump version (updates package.json, creates git tag)
npm version patch   # 0.1.0 -> 0.1.1 (bug fixes)
npm version minor   # 0.1.0 -> 0.2.0 (new features)
npm version major   # 0.1.0 -> 1.0.0 (breaking changes)

# 3. Push code and tags
git push --follow-tags

# 4. Create GitHub release
gh release create v0.1.1 --title "v0.1.1" --notes "Release description"

# Or with generated notes
gh release create v0.1.1 --generate-notes
```

### Update Local Development Version

If you have the plugin installed locally and want to update:

```bash
# Option 1: Reinstall from npm
npm install -g @rezamonangg/opencode-rtk@latest

# Option 2: Link local development version
cd /path/to/opencode_rtk_plugin
npm link

# Option 3: Direct path in opencode.json
# Edit ~/.config/opencode/opencode.json:
{
  "plugin": ["/path/to/opencode_rtk_plugin"]
}
```

### Manual Build & Publish

```bash
bun run build
npm publish --access public --otp=<2fa-code>
```
