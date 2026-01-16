#!/usr/bin/env node

import consola from "consola"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import { ensurePaths, PATHS } from "./lib/paths"
import { isPortInUse, sendShutdownRequest } from "./lib/port-check"
import { setupGitHubToken } from "./lib/token"
import { getCopilotToken } from "./services/github/get-copilot-token"
import { state } from "./lib/state"

const PORT = 5678
const SERVER_START_TIMEOUT = 8000 // Timeout for server initialization

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
  const tokenState = await getTokenState()
  const portInUse = await isPortInUse(PORT)

  if (!portInUse) {
    consola.info("Copilot Proxy Server is not running")
    displayTokenState(tokenState)
    return
  }

  // Server is running
  consola.success(`Copilot Proxy Server is running`)
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

// Stop command: graceful shutdown via HTTP request
async function stopCommand(): Promise<void> {
  const portInUse = await isPortInUse(PORT)
  if (!portInUse) {
    consola.info("Copilot Proxy Server is not running")
    return
  }

  consola.info(`Stopping Copilot Proxy Server on port ${PORT}...`)

  // Send shutdown request to the server
  const success = await sendShutdownRequest(PORT)

  if (success) {
    // Wait longer for server to fully shut down and release port
    const maxWait = 5000 // 5 seconds
    const startWait = Date.now()
    
    while (Date.now() - startWait < maxWait) {
      await new Promise((r) => setTimeout(r, 300))
      const stillRunning = await isPortInUse(PORT)
      if (!stillRunning) {
        consola.success("Copilot Proxy Server stopped")
        return
      }
    }
    
    consola.warn("Server did not release port within timeout")
    consola.info("You may need to wait a moment before restarting")
  } else {
    consola.error("Failed to send shutdown request to server")
    consola.info(
      "If the server is running externally, use Ctrl+C or kill the process manually",
    )
    process.exit(1)
  }
}

// Start command: check port availability, spawn detached server
async function startCommand(): Promise<void> {
  // Check if port is already in use
  const portInUse = await isPortInUse(PORT)
  if (portInUse) {
    consola.info(`Copilot Proxy Server is already running on http://localhost:${PORT}`)
    return
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

  // Wait and verify server starts by polling port
  const maxWait = SERVER_START_TIMEOUT
  const startTime = Date.now()
  let serverStarted = false
  
  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isPortInUse(PORT)) {
      serverStarted = true
      break
    }
  }

  if (serverStarted) {
    consola.success("Copilot Proxy Server started successfully")
    consola.info(`  Port: ${PORT}`)
    consola.info(`  URL:  http://localhost:${PORT}`)
  } else {
    consola.error("Server failed to start (port is not bound)")
    consola.info(`Check logs at: ${logPath}`)
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
