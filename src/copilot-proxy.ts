#!/usr/bin/env node

import consola from "consola"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import { readPid, removePid, isProcessAlive } from "./daemon/pid"
import { ensurePaths, PATHS } from "./lib/paths"
import { setupGitHubToken } from "./lib/token"
import { getCopilotToken } from "./services/github/get-copilot-token"
import { state } from "./lib/state"

const PORT = 5678
const SERVER_START_TIMEOUT = 8000 // Increased timeout for server initialization

// Check token state without forcing auth
async function getTokenState(): Promise<
  "valid" | "expiring" | "expired" | "missing"
> {
  try {
    const tokenContent = await fs.readFile(PATHS.TOKEN_PATH, "utf8")
    if (!tokenContent.trim()) {
      return "missing"
    }

    // Try to get a Copilot token to validate GitHub token
    state.githubToken = tokenContent.trim()
    const { expires_at } = await getCopilotToken()

    const now = Math.floor(Date.now() / 1000)
    const timeUntilExpiry = expires_at - now

    if (timeUntilExpiry < 0) {
      return "expired"
    } else if (timeUntilExpiry < 300) {
      // Less than 5 minutes
      return "expiring"
    } else {
      return "valid"
    }
  } catch {
    return "missing"
  }
}

// Status command: check if server is running
async function statusCommand(): Promise<void> {
  const pid = await readPid()
  const tokenState = await getTokenState()

  if (!pid) {
    consola.info("Copilot Proxy Server is not running")
    displayTokenState(tokenState)
    return
  }

  // Validate the process actually exists
  const alive = await isProcessAlive(pid)
  if (!alive) {
    consola.warn(`Stale PID file found (process ${pid} does not exist)`)
    await removePid()
    consola.info("Copilot Proxy Server is not running")
    displayTokenState(tokenState)
    return
  }

  // Server is running
  consola.success(`Copilot Proxy Server is running`)
  consola.info(`  PID:  ${pid}`)
  consola.info(`  Port: ${PORT}`)
  consola.info(`  URL:  http://localhost:${PORT}`)
  displayTokenState(tokenState)
}

function displayTokenState(
  tokenState: "valid" | "expiring" | "expired" | "missing",
): void {
  switch (tokenState) {
    case "valid":
      consola.success("  Token: Valid")
      break
    case "expiring":
      consola.warn("  Token: Expiring soon (run: copilot-proxy auth)")
      break
    case "expired":
      consola.error("  Token: Expired (run: copilot-proxy auth)")
      break
    case "missing":
      consola.error("  Token: Missing (run: copilot-proxy auth)")
      break
  }
}

// Auth command: force GitHub authentication
async function authCommand(): Promise<void> {
  await ensurePaths()

  consola.info("Starting GitHub authentication...")
  try {
    await setupGitHubToken({ force: true })
    consola.success("Authentication successful!")
    consola.info("You can now run: copilot-proxy start")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consola.error("Authentication failed:", message)
    process.exit(1)
  }
}

// Check if GitHub token exists
async function hasValidToken(): Promise<boolean> {
  try {
    const tokenContent = await fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")
    return tokenContent.trim().length > 0
  } catch {
    return false
  }
}

// Stop command: graceful shutdown with fallback
async function stopCommand(): Promise<void> {
  const pid = await readPid()
  if (!pid) {
    consola.info("Copilot Proxy Server is not running")
    return
  }

  // Validate the process actually exists
  const alive = await isProcessAlive(pid)
  if (!alive) {
    consola.warn(`Stale PID file found (process ${pid} does not exist)`)
    await removePid()
    consola.info("Copilot Proxy Server was not running")
    return
  }

  consola.info(`Stopping Copilot Proxy Server (PID ${pid})...`)

  try {
    // Try graceful stop
    process.kill(pid, "SIGTERM")
  } catch (err) {
    consola.warn(`Failed to send SIGTERM to ${pid}: ${err}`)
  }

  // Wait for process to exit for up to 10s
  const start = Date.now()
  while (Date.now() - start < 10000) {
    const stillAlive = await isProcessAlive(pid)
    if (!stillAlive) {
      consola.success("Copilot Proxy Server stopped")
      // Ensure PID file is removed even if hooks failed
      await removePid()
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  consola.warn("Server did not exit within timeout; forcing termination")
  try {
    if (process.platform === "win32") {
      // Windows: use taskkill to kill process tree
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" })
    } else {
      // POSIX: kill process group
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        process.kill(pid, "SIGKILL")
      }
    }
    consola.info("Copilot Proxy Server forcefully terminated")
    await removePid()
  } catch (err) {
    consola.error("Failed to force kill server:", err)
  }
}

// Start command: check not running, auth, spawn detached
async function startCommand(): Promise<void> {
  // Check if already running
  const pid = await readPid()
  if (pid) {
    // Verify the process is actually alive
    const alive = await isProcessAlive(pid)
    if (alive) {
      consola.info(`Copilot Proxy Server is already running on http://localhost:${PORT}`)
      consola.info(`  PID: ${pid}`)
      return
    } else {
      // Stale PID file, clean it up
      consola.warn(`Removing stale PID file (process ${pid} does not exist)`)
      await removePid()
    }
  }

  // Ensure paths exist
  await ensurePaths()

  // Check if token exists
  const tokenExists = await hasValidToken()
  if (!tokenExists) {
    consola.error("GitHub token not found or invalid")
    consola.info("Please authenticate first by running: copilot-proxy auth")
    process.exit(1)
  }

  // Validate auth (will use existing token)
  consola.info("Validating GitHub authentication...")
  try {
    await setupGitHubToken({ force: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    consola.error("Authentication failed:", message)
    consola.info("Please re-authenticate by running: copilot-proxy auth")
    process.exit(1)
  }

  // Spawn detached server process
  consola.info("Starting Copilot Proxy Server...")

  // Find the main.js - handle path differently on Windows
  let mainScript: string
  if (process.platform === "win32") {
    // On Windows, use fileURLToPath to properly convert
    const { fileURLToPath } = await import("node:url")
    const cliPath = fileURLToPath(import.meta.url)
    mainScript = path.join(path.dirname(cliPath), "main.js")
  } else {
    mainScript = new URL("./main.js", import.meta.url).pathname
  }

  // Create a log file for debugging
  const logPath = path.join(PATHS.APP_DIR, "server.log")
  const logFd = await fs.open(logPath, "w")

  const child = spawn(process.execPath, [mainScript, "start", "--daemon"], {
    detached: true,
    stdio: ["ignore", logFd.fd, logFd.fd],
    env: {
      ...process.env,
      _COPILOT_DAEMON_CHILD: "1",
      NODE_ENV: "production",
    },
    windowsHide: true,
  })

  child.unref()
  await logFd.close()

  // Wait briefly to ensure server starts
  await new Promise((r) => setTimeout(r, SERVER_START_TIMEOUT))

  // Verify server is running
  const newPid = await readPid()
  if (newPid && await isProcessAlive(newPid)) {
    consola.success("Copilot Proxy Server started successfully")
    consola.info(`  PID:  ${newPid}`)
    consola.info(`  Port: ${PORT}`)
    consola.info(`  URL:  http://localhost:${PORT}`)
  } else {
    consola.error("Server failed to start (no PID file created or process not alive)")
    process.exit(1)
  }
}

// Main CLI handler
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  try {
    switch (command) {
      case "start": {
        await startCommand()
        break
      }
      case "stop": {
        await stopCommand()
        break
      }
      case "status": {
        await statusCommand()
        break
      }
      case "auth": {
        await authCommand()
        break
      }
      case "help":
      case "--help":
      case "-h":
      case undefined: {
        showHelp()
        break
      }
      default: {
        consola.error(`Unknown command: ${command}`)
        showHelp()
        process.exit(1)
      }
    }
  } catch (err) {
    consola.error("Command failed:", err)
    process.exit(1)
  }
}

function showHelp(): void {
  console.log(
    `
Copilot Proxy Server

Usage:
  copilot-proxy <command>

Commands:
  auth    Authenticate with GitHub Copilot (run this first)
  start   Start the Copilot Proxy Server in the background
  stop    Stop the running Copilot Proxy Server
  status  Check if the server is running

Examples:
  copilot-proxy auth     # Authenticate with GitHub (first time setup)
  copilot-proxy start    # Start server
  copilot-proxy status   # Check server status
  copilot-proxy stop     # Stop server gracefully

The server runs on http://localhost:${PORT}
`.trim(),
  )
}

// Run CLI
void main()
