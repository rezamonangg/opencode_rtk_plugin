#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { execSync } from "child_process"

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
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

function removePluginFromConfig(): void {
  const configPath = getOpenCodeConfigPath()
  const config = readOpenCodeConfig()

  if (!config.plugin) {
    log("ℹ Plugin not configured", "yellow")
    return
  }

  const index = config.plugin.indexOf("@rezamonangg/opencode-rtk")
  if (index > -1) {
    config.plugin.splice(index, 1)
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
    log("✓ Plugin removed from opencode.json", "green")
  } else {
    log("ℹ Plugin not configured", "yellow")
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

function showHelp() {
  log("\n" + "=".repeat(50), "bold")
  log("OpenCode RTK Plugin", "cyan")
  log("=".repeat(50) + "\n", "bold")
  
  log("A plugin that automatically rewrites bash commands to use RTK,")
  log("reducing LLM token consumption by 60-90%.\n")
  
  log("Usage:", "bold")
  log("  npx @rezamonangg/opencode-rtk <command>\n")
  
  log("Commands:", "bold")
  log("  install     Install the plugin to OpenCode config")
  log("  uninstall   Remove the plugin from OpenCode config")
  log("  status      Check installation status")
  log("  help        Show this help message\n")
  
  log("Examples:", "bold")
  log("  npx @rezamonangg/opencode-rtk install")
  log("  bunx @rezamonangg/opencode-rtk install\n")
  
  log("Documentation:", "bold")
  log("  https://github.com/rezamonangg/opencode_rtk_plugin#readme\n")
}

async function install() {
  log("\n" + "=".repeat(50), "bold")
  log("OpenCode RTK Plugin - Install", "cyan")
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
}

async function uninstall() {
  log("\n" + "=".repeat(50), "bold")
  log("OpenCode RTK Plugin - Uninstall", "cyan")
  log("=".repeat(50) + "\n", "bold")

  const config = readOpenCodeConfig()
  
  if (!isPluginConfigured(config)) {
    log("ℹ Plugin is not configured", "yellow")
    process.exit(0)
  }

  console.log("")
  const shouldRemove = await askQuestion(
    "Remove @rezamonangg/opencode-rtk from your OpenCode config?"
  )
  
  if (shouldRemove) {
    removePluginFromConfig()
    log("\n✓ Plugin removed. Restart OpenCode for changes to take effect.", "green")
  } else {
    log("\nUninstall cancelled.", "yellow")
  }
  
  console.log("")
}

function status() {
  log("\n" + "=".repeat(50), "bold")
  log("OpenCode RTK Plugin - Status", "cyan")
  log("=".repeat(50) + "\n", "bold")

  // Check RTK
  const rtkInstalled = checkCommand("rtk")
  if (rtkInstalled) {
    const version = getRtkVersion()
    log(`✓ RTK installed: ${version || "unknown version"}`, "green")
  } else {
    log("✗ RTK not found in PATH", "red")
  }

  // Check OpenCode config
  const configPath = getOpenCodeConfigPath()
  if (existsSync(configPath)) {
    log(`✓ OpenCode config: ${configPath}`, "green")
    
    const config = readOpenCodeConfig()
    if (isPluginConfigured(config)) {
      log(`✓ Plugin configured: @rezamonangg/opencode-rtk`, "green")
    } else {
      log(`ℹ Plugin not configured`, "yellow")
    }
  } else {
    log(`✗ OpenCode config not found`, "red")
  }

  console.log("")
}

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  switch (command) {
    case "install":
      await install()
      break
    case "uninstall":
      await uninstall()
      break
    case "status":
      status()
      break
    case "help":
    case "--help":
    case "-h":
      showHelp()
      break
    case undefined:
      // No command provided - default to help
      showHelp()
      break
    default:
      log(`\n✗ Unknown command: ${command}`, "red")
      log("\nRun `npx @rezamonangg/opencode-rtk help` for usage information.\n")
      process.exit(1)
  }
}

main().catch((error) => {
  console.error("Error:", error)
  process.exit(1)
})
