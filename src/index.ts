import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

// ============================================================
// Configuration
// ============================================================

interface RtkConfig {
  enabled: boolean
  commands: string[]
  rewriteMap: Record<string, string>
}

const DEFAULT_CONFIG: RtkConfig = {
  enabled: true,
  commands: [
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
    "npm test",
  ],
  rewriteMap: {
    cat: "rtk read",
    rg: "rtk grep",
    eslint: "rtk lint",
  },
}

function loadOrCreateConfig(configDir: string): RtkConfig {
  const configPath = join(configDir, "rtk-wrapper-config.json")

  if (!existsSync(configPath)) {
    // Auto-create config with defaults on first run.
    try {
      mkdirSync(configDir, { recursive: true })
      writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8")
    } catch {
      // If we can't write (e.g. permissions), fall back to in-memory defaults.
    }
    return { ...DEFAULT_CONFIG, rewriteMap: { ...DEFAULT_CONFIG.rewriteMap } }
  }

  try {
    const raw = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw)
    return {
      enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
      commands: Array.isArray(parsed.commands)
        ? parsed.commands
        : DEFAULT_CONFIG.commands,
      rewriteMap:
        parsed.rewriteMap != null && typeof parsed.rewriteMap === "object"
          ? parsed.rewriteMap
          : { ...DEFAULT_CONFIG.rewriteMap },
    }
  } catch {
    // Malformed config — fall back to defaults silently.
    return { ...DEFAULT_CONFIG, rewriteMap: { ...DEFAULT_CONFIG.rewriteMap } }
  }
}

// ============================================================
// Matching Logic
// ============================================================

/**
 * Checks if a command matches any configured pattern using prefix + word-boundary logic.
 *
 * "ls"  matches "ls" and "ls -la" but NOT "lsof".
 * "git" matches "git status" and "git diff" but NOT "github-cli".
 */
function shouldWrap(command: string, patterns: string[]): boolean {
  const trimmed = command.trim()
  return patterns.some(
    (pattern) => trimmed === pattern || trimmed.startsWith(pattern + " ")
  )
}

/**
 * Returns false for commands with shell constructs RTK cannot handle:
 * pipes (|), AND/OR chains (&&, ||), semicolons (;), heredocs (<<).
 */
function isSimpleCommand(command: string): boolean {
  return !/[|;]|&&|\|\||<</.test(command)
}

// ============================================================
// Rewrite Logic
// ============================================================

/**
 * Rewrites a command to its RTK equivalent.
 *
 * Checks rewriteMap first for commands with different RTK names
 * (e.g. "cat" -> "rtk read"), then falls back to prepending "rtk ".
 */
function rewriteCommand(command: string, rewriteMap: Record<string, string>): string {
  const trimmed = command.trim()
  const firstWord = trimmed.split(/\s+/)[0]

  if (firstWord in rewriteMap) {
    return trimmed.replace(firstWord, rewriteMap[firstWord])
  }

  return `rtk ${trimmed}`
}

// ============================================================
// Plugin Export
// ============================================================

export const RTKPlugin: Plugin = async ({ client }) => {
  const configDir =
    process.env.OPENCODE_CONFIG_DIR ??
    join(
      process.env.HOME ?? process.env.USERPROFILE ?? "",
      ".config",
      "opencode"
    )

  const config = loadOrCreateConfig(configDir)

  if (!config.enabled) {
    await client.app.log({
      body: {
        service: "opencode-rtk",
        level: "debug",
        message: "RTK plugin is disabled via config",
      },
    })
    return {}
  }

  await client.app.log({
    body: {
      service: "opencode-rtk",
      level: "debug",
      message: `RTK plugin loaded. Wrapping ${config.commands.length} command patterns: [${config.commands.join(", ")}]`,
    },
  })

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const command = output.args.command as string
      if (!command) return

      const trimmed = command.trim()

      if (trimmed.startsWith("rtk ")) return
      if (!isSimpleCommand(trimmed)) return
      if (!shouldWrap(trimmed, config.commands)) return

      const rewritten = rewriteCommand(trimmed, config.rewriteMap)
      output.args.command = rewritten

      await client.app.log({
        body: {
          service: "opencode-rtk",
          level: "debug",
          message: `RTK rewrite: "${trimmed}" -> "${rewritten}"`,
        },
      })
    },
  }
}

export default RTKPlugin
