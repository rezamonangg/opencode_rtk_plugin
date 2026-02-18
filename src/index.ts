import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"

// ============================================================
// Session Stats (module-scope — resets on plugin reload)
// ============================================================

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

// ============================================================
// Stats Formatting
// ============================================================

function formatSessionStats(stats: SessionStats): string {
  const elapsed = Date.now() - stats.startedAt.getTime()
  const minutes = Math.floor(elapsed / 60_000)
  const hours = Math.floor(minutes / 60)
  const duration = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`

  if (stats.rewriteCount === 0) {
    return `RTK Session Stats (${duration})\nNo commands rewritten yet.`
  }

  const sorted = Object.entries(stats.commands).sort(([, a], [, b]) => b - a)
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

  // Auto-create the /rtk-gain slash command file if absent.
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
          "",
          "Execute the rtk_gain tool immediately and show the result to the user. Do not ask any questions.",
        ].join("\n"),
        "utf-8"
      )
    } catch {
      // Non-fatal — user can create the file manually.
    }
  }

  await client.app.log({
    body: {
      service: "opencode-rtk",
      level: "debug",
      message: `RTK plugin loaded. Wrapping ${config.commands.length} command patterns: [${config.commands.join(", ")}]`,
    },
  })

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
      if (input.tool !== "bash") return

      const command = output.args.command as string
      if (!command) return

      const trimmed = command.trim()

      if (trimmed.startsWith("rtk ")) return
      if (!isSimpleCommand(trimmed)) return
      if (!shouldWrap(trimmed, config.commands)) return

      const rewritten = rewriteCommand(trimmed, config.rewriteMap)
      output.args.command = rewritten

      // Track the rewrite for /rtk-gain stats.
      sessionStats.rewriteCount++
      const words = trimmed.split(/\s+/)
      const cmdKey = words.length >= 2 ? `${words[0]} ${words[1]}` : words[0]
      sessionStats.commands[cmdKey] = (sessionStats.commands[cmdKey] ?? 0) + 1

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
