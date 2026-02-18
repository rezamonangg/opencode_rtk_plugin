# NPM Publishing & CLI Setup Plan

**Package:** `@rezamonangg/opencode-rtk`  
**Goal:** Publish to npm so users can install via `npx @rezamonangg/opencode-rtk` with setup helper  
**Status:** Draft - Pending Approval  

---

## Overview

This plan covers publishing `opencode-rtk` as an npm package under the scoped name `@rezamonangg/opencode-rtk`. When users run `npx @rezamonangg/opencode-rtk` or `bunx @rezamonangg/opencode-rtk`, they'll get an interactive setup helper that:

1. Checks if RTK is installed
2. Checks if OpenCode is configured
3. Optionally adds the plugin to `opencode.json`
4. Provides status and next steps

---

## Prerequisites

### 1. NPM Account

**Yes, you need an npm account.** Here's how:

```bash
# Sign up at https://www.npmjs.com/signup
# Or via CLI:
npm adduser
```

**For scoped packages (@username/package):**
- Free npm accounts can publish scoped packages
- No need for paid npm Pro/Teams
- Scoped packages are private by default (you'll set `--access public`)

### 2. Login to NPM

```bash
npm login
# Enter your npm username, password, and email
```

---

## Package Configuration Changes

### Updated package.json

```json
{
  "name": "@rezamonangg/opencode-rtk",
  "version": "0.1.0",
  "description": "OpenCode plugin that transparently wraps eligible bash commands with RTK to reduce LLM token consumption by 60-90%",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "type": "module",
  "bin": {
    "opencode-rtk": "dist/cli.js"
  },
  "files": [
    "dist",
    "rtk-wrapper-config.example.json"
  ],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun --format esm && bun build src/cli.ts --outdir dist --target node --format esm && tsc --emitDeclarationOnly",
    "prepublishOnly": "bun run build",
    "typecheck": "tsc --noEmit"
  },
  "keywords": [
    "opencode",
    "plugin",
    "rtk",
    "tokens",
    "ai",
    "llm"
  ],
  "author": "Reza Monangg",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/rezamonangg/opencode_rtk_plugin.git"
  },
  "bugs": {
    "url": "https://github.com/rezamonangg/opencode_rtk_plugin/issues"
  },
  "homepage": "https://github.com/rezamonangg/opencode_rtk_plugin#readme",
  "devDependencies": {
    "@opencode-ai/plugin": "^1.1.53",
    "bun-types": "^1.0.0",
    "typescript": "^5.7.3"
  },
  "peerDependencies": {
    "@opencode-ai/plugin": "^1.0.0"
  }
}
```

**Key changes:**
- `name`: Changed to scoped package `@rezamonangg/opencode-rtk`
- `bin`: Added CLI entry point
- `repository`: Updated to your GitHub URL
- `author`: Added your name
- `peerDependencies`: Added for OpenCode plugin compatibility

---

## File Structure

```
/
├── src/
│   ├── index.ts          # Plugin export (existing)
│   └── cli.ts            # NEW: CLI entry point for npx
├── dist/                 # Build output (gitignored)
│   ├── index.js
│   ├── index.d.ts
│   └── cli.js            # Built CLI script
├── docs/
│   ├── PLAN.md
│   └── NPM-PUBLISH-PLAN.md    # This file
├── package.json
├── tsconfig.json
└── README.md
```

---

## CLI Implementation (src/cli.ts)

The CLI will be a setup helper that runs when users execute `npx @rezamonangg/opencode-rtk`:

```typescript
#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs"
import { join, homedir } from "path"
import { execSync } from "child_process"

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
}

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function checkCommand(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

function getRtkVersion(): string | null {
  try {
    const output = execSync("rtk --version", { encoding: "utf-8" })
    return output.trim()
  } catch {
    return null
  }
}

function getOpenCodeConfigDir(): string {
  return (
    process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode")
  )
}

function getOpenCodeConfigPath(): string {
  return join(getOpenCodeConfigDir(), "opencode.json")
}

function readOpenCodeConfig(): any {
  const configPath = getOpenCodeConfigPath()
  if (!existsSync(configPath)) {
    return { plugin: [] }
  }
  try {
    const content = readFileSync(configPath, "utf-8")
    return JSON.parse(content)
  } catch {
    return { plugin: [] }
  }
}

function isPluginConfigured(config: any): boolean {
  const plugins = config.plugin || []
  return plugins.some(
    (p: string) =>
      p === "@rezamonangg/opencode-rtk" ||
      p.startsWith("@rezamonangg/opencode-rtk@")
  )
}

function addPluginToConfig(): void {
  const configPath = getOpenCodeConfigPath()
  const config = readOpenCodeConfig()

  if (!config.plugin) {
    config.plugin = []
  }

  if (!config.plugin.includes("@rezamonangg/opencode-rtk")) {
    config.plugin.push("@rezamonangg/opencode-rtk")
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    log("✓ Plugin added to opencode.json", "green")
  } else {
    log("ℹ Plugin already configured", "yellow")
  }
}

async function askQuestion(question: string): Promise<boolean> {
  process.stdout.write(`${colors.cyan}?${colors.reset} ${question} [Y/n] `)
  
  return new Promise((resolve) => {
    process.stdin.once("data", (data) => {
      const input = data.toString().trim().toLowerCase()
      resolve(input === "" || input === "y" || input === "yes")
    })
  })
}

async function main() {
  log("\n" + "=".repeat(50), "bold")
  log("OpenCode RTK Plugin Setup", "cyan")
  log("=".repeat(50) + "\n", "bold")

  // Check 1: RTK Installation
  log("Checking prerequisites...\n", "bold")
  
  const rtkInstalled = checkCommand("rtk")
  if (rtkInstalled) {
    const version = getRtkVersion()
    log(`✓ RTK installed: ${version || "unknown version"}`, "green")
  } else {
    log("✗ RTK not found in PATH", "red")
    log("\nPlease install RTK first:", "yellow")
    log("  https://github.com/rtk-ai/rtk#installation\n")
    process.exit(1)
  }

  // Check 2: OpenCode Config
  const configDir = getOpenCodeConfigDir()
  const configPath = getOpenCodeConfigPath()
  
  if (existsSync(configPath)) {
    log(`✓ OpenCode config found: ${configPath}`, "green")
  } else {
    log(`✗ OpenCode config not found at: ${configPath}`, "red")
    log("\nPlease ensure OpenCode is installed and has been run at least once.")
    process.exit(1)
  }

  // Check 3: Plugin Status
  const config = readOpenCodeConfig()
  const isConfigured = isPluginConfigured(config)
  
  if (isConfigured) {
    log("✓ Plugin already configured in opencode.json", "green")
  } else {
    log("ℹ Plugin not yet configured", "yellow")
  }

  // Installation prompt
  if (!isConfigured) {
    console.log("")
    const shouldInstall = await askQuestion(
      "Add @rezamonangg/opencode-rtk to your OpenCode config?"
    )
    
    if (shouldInstall) {
      addPluginToConfig()
    } else {
      log("\nSkipped. You can manually add it later:", "yellow")
      log('  "plugin": ["@rezamonangg/opencode-rtk"]')
    }
  }

  // Summary
  console.log("")
  log("=".repeat(50), "bold")
  log("Next Steps", "cyan")
  log("=".repeat(50) + "\n", "bold")
  
  log("1. Restart OpenCode to load the plugin")
  log("2. The plugin will automatically rewrite eligible commands to use RTK")
  log("3. Check debug logs to see rewrites in action\n")
  
  log("Configuration:", "bold")
  log(`  Config file: ${join(configDir, "rtk-wrapper-config.json")}`)
  log("  This file will be auto-created on first plugin load\n")
  
  log("Documentation:", "bold")
  log("  https://github.com/rezamonangg/opencode_rtk_plugin#readme\n")
  
  process.exit(0)
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
```

---

## Build Configuration

### Updated build script

The build needs to produce both the plugin (for OpenCode) and CLI (for npx):

```bash
# Build plugin for OpenCode (Bun target)
bun build src/index.ts --outdir dist --target bun --format esm

# Build CLI for Node.js (Node target, includes shebang)
bun build src/cli.ts --outdir dist --target node --format esm

# Generate TypeScript declarations
tsc --emitDeclarationOnly
```

Or in package.json:

```json
{
  "scripts": {
    "build:plugin": "bun build src/index.ts --outdir dist --target bun --format esm",
    "build:cli": "bun build src/cli.ts --outdir dist --target node --format esm",
    "build": "bun run build:plugin && bun run build:cli && tsc --emitDeclarationOnly",
    "prepublishOnly": "bun run build"
  }
}
```

---

## Publishing Steps

### 1. Prepare for Publishing

```bash
# Ensure you're logged in
npm whoami

# Check current version
cat package.json | grep version

# Update version if needed (semantic versioning)
npm version patch   # 0.1.0 -> 0.1.1
npm version minor   # 0.1.0 -> 0.2.0
npm version major   # 0.1.0 -> 1.0.0
```

### 2. Build and Test Locally

```bash
# Build the package
bun run build

# Test the CLI locally
node dist/cli.js

# Verify the binary works
npm link
npx @rezamonangg/opencode-rtk
npm unlink
```

### 3. Publish to NPM

```bash
# Publish as public scoped package
npm publish --access public

# For subsequent updates (after version bump)
npm publish
```

### 4. Verify Publication

```bash
# Check the package on npm
npm view @rezamonangg/opencode-rtk

# Test installation via npx
npx @rezamonangg/opencode-rtk

# Or with bun
bunx @rezamonangg/opencode-rtk
```

---

## User Installation Flow

### Method 1: Automatic Setup (Recommended)

```bash
# User runs the setup helper
npx @rezamonangg/opencode-rtk

# This will:
# 1. Check RTK is installed
# 2. Check OpenCode config exists
# 3. Prompt to add plugin to opencode.json
# 4. Show next steps
```

### Method 2: Manual Installation

Users can also manually add to their `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@rezamonangg/opencode-rtk"]
}
```

Then restart OpenCode.

### Method 3: Local Development

```bash
git clone https://github.com/rezamonangg/opencode_rtk_plugin.git
cd opencode_rtk_plugin
bun install
bun run build
```

Then reference locally:

```json
{
  "plugin": ["/absolute/path/to/opencode_rtk_plugin"]
}
```

---

## Version Management

### Semantic Versioning

- **Patch** (0.1.0 → 0.1.1): Bug fixes, minor tweaks
- **Minor** (0.1.0 → 0.2.0): New features, backwards compatible
- **Major** (0.1.0 → 1.0.0): Breaking changes

### Publishing Updates

```bash
# 1. Update version
npm version patch  # or minor/major

# 2. Build
bun run build

# 3. Publish
npm publish

# 4. Push git tags
git push --follow-tags
```

---

## Testing Checklist

Before publishing, verify:

- [ ] `bun run build` completes without errors
- [ ] `dist/cli.js` exists and is executable
- [ ] `dist/index.js` exists (plugin entry point)
- [ ] `npm pack` shows correct files
- [ ] Local test with `npm link` works
- [ ] README badges/names updated to scoped package
- [ ] package.json repository URL is correct
- [ ] `npm whoami` shows you're logged in

---

## Common Issues & Solutions

### Issue: "Package name is already taken"
**Solution:** Use scoped package `@rezamonangg/opencode-rtk`

### Issue: "You must be logged in"
**Solution:** Run `npm login` first

### Issue: "Cannot find module '@opencode-ai/plugin'"
**Solution:** Move to `peerDependencies` or `devDependencies`, not `dependencies`

### Issue: "dist/cli.js not executable"
**Solution:** Ensure bun build includes shebang, or add manually:
```bash
echo '#!/usr/bin/env node' | cat - dist/cli.js > temp && mv temp dist/cli.js
chmod +x dist/cli.js
```

### Issue: "npx command not found"
**Solution:** Scoped packages require full name:
```bash
npx @rezamonangg/opencode-rtk  # Correct
npx opencode-rtk               # Won't work
```

---

## Post-Publishing Checklist

After publishing:

- [ ] Update README.md installation instructions
- [ ] Add npm badge to README
- [ ] Create GitHub release with changelog
- [ ] Test `npx @rezamonangg/opencode-rtk` on a clean machine
- [ ] Announce on social media/communities if desired

---

## NPM Badge for README

```markdown
[![npm version](https://img.shields.io/npm/v/@rezamonangg/opencode-rtk.svg)](https://www.npmjs.com/package/@rezamonangg/opencode-rtk)
[![npm downloads](https://img.shields.io/npm/dt/@rezamonangg/opencode-rtk.svg)](https://www.npmjs.com/package/@rezamonangg/opencode-rtk)
```

---

## Summary

**What we're building:**
1. CLI setup helper (`src/cli.ts`) that runs via `npx`
2. Updated `package.json` with scoped name and `bin` entry
3. Dual build system (plugin + CLI)
4. Automated configuration of OpenCode plugin

**User experience:**
```bash
$ npx @rezamonangg/opencode-rtk
==================================================
OpenCode RTK Plugin Setup
==================================================

Checking prerequisites...

✓ RTK installed: rtk 0.21.1
✓ OpenCode config found: /home/user/.config/opencode/opencode.json
ℹ Plugin not yet configured

? Add @rezamonangg/opencode-rtk to your OpenCode config? [Y/n] y
✓ Plugin added to opencode.json

==================================================
Next Steps
==================================================

1. Restart OpenCode to load the plugin
2. The plugin will automatically rewrite eligible commands to use RTK
3. Check debug logs to see rewrites in action
```

**Ready to implement?** I can create all the files and walk you through publishing.
