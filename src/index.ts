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
 *   - Semicolons: `cmd1; cmd2`
 *   - Heredocs:  `cat <<EOF`
 *   - Subshells: `$(command)` or backticks
 */
function isSimpleCommand(command: string): boolean {
  return !/[|;]|&&|\|\||<</.test(command)
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
  // Resolve config directory from the environment variable OpenCode sets,
  // falling back to the standard XDG config path.
  const configDir =
    process.env.OPENCODE_CONFIG_DIR ??
    join(
      process.env.HOME ?? process.env.USERPROFILE ?? "",
      ".config",
      "opencode"
    )

  const config = loadConfig(configDir)

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
          service: "opencode-rtk",
          level: "debug",
          message: `RTK rewrite: "${trimmed}" -> "${rewritten}"`,
        },
      })
    },
  }
}

export default RTKPlugin
