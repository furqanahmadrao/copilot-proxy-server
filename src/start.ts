#!/usr/bin/env node

import { defineCommand } from "citty"
import clipboard from "clipboardy"
import consola from "consola"
import fs from "node:fs/promises"
import { serve, type ServerHandler } from "srvx"
import invariant from "tiny-invariant"

import { computeInteractive } from "./lib/interactive" // helper to determine TTY/interactive state
import { ensurePaths, PATHS } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { generateEnvScript } from "./lib/shell"
import { state } from "./lib/state"
import { setupCopilotToken, setupGitHubToken } from "./lib/token"
import { cacheModels, cacheVSCodeVersion } from "./lib/utils"
import { server } from "./server"

interface RunServerOptions {
  port: number
  verbose: boolean
  accountType: string
  manual: boolean
  rateLimit?: number
  rateLimitWait: boolean
  githubToken?: string
  claudeCode: boolean
  showToken: boolean
  proxyEnv: boolean
  // Daemon-related flags (opt-in)
  daemon?: boolean
  noInteractive?: boolean
  interactive?: boolean
}

export async function runServer(options: RunServerOptions): Promise<void> {
  // Daemon-mode and interactive handling
  // Determine if we should run interactively. In daemon/non-interactive modes
  // interactive prompts (e.g., manual approval) are disallowed to avoid blocking
  // when the process is detached from a TTY.
  const interactive = computeInteractive({
    daemon: options.daemon,
    noInteractive: options.noInteractive,
    forceInteractive: options.interactive,
  })

  if (!interactive && options.manual) {
    consola.error(
      "Cannot enable manual approval (--manual) when running without a TTY (daemon or --no-interactive).",
    )
    throw new Error("Manual approval requires an interactive terminal")
  }

  if (options.proxyEnv) {
    initProxyFromEnv()
  }

  if (options.verbose) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.accountType = options.accountType
  if (options.accountType !== "individual") {
    consola.info(`Using ${options.accountType} plan GitHub account`)
  }

  state.manualApprove = options.manual
  state.rateLimitSeconds = options.rateLimit
  state.rateLimitWait = options.rateLimitWait
  state.showToken = options.showToken

  await ensurePaths()
  await cacheVSCodeVersion()

  if (options.githubToken) {
    state.githubToken = options.githubToken
    consola.info("Using provided GitHub token")
  } else {
    // Check if we have a token file first
    let hasTokenFile = false
    try {
      const existingToken = await fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")
      hasTokenFile = existingToken.trim().length > 0
    } catch {
      hasTokenFile = false
    }

    // In non-interactive/daemon mode, we cannot perform device-code auth.
    // Require a pre-existing GitHub token (via flag or file) to avoid blocking.
    if (!interactive && !hasTokenFile) {
      consola.error(
        "Cannot perform interactive GitHub auth in non-interactive mode. Provide a GitHub token via --github-token or place it in the token file.",
      )
      throw new Error(
        "Interactive GitHub auth required but not available in non-interactive mode",
      )
    }

    await setupGitHubToken()
  }

  const copilotRefresher = await setupCopilotToken()
  await cacheModels()

  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )

  const serverUrl = `http://localhost:${options.port}`

  if (options.claudeCode) {
    invariant(state.models, "Models should be loaded by now")

    const selectedModel = await consola.prompt(
      "Select a model to use with Claude Code",
      {
        type: "select",
        options: state.models.data.map((model) => model.id),
      },
    )

    const selectedSmallModel = await consola.prompt(
      "Select a small model to use with Claude Code",
      {
        type: "select",
        options: state.models.data.map((model) => model.id),
      },
    )

    const command = generateEnvScript(
      {
        ANTHROPIC_BASE_URL: serverUrl,
        ANTHROPIC_AUTH_TOKEN: "dummy",
        ANTHROPIC_MODEL: selectedModel,
        ANTHROPIC_DEFAULT_SONNET_MODEL: selectedModel,
        ANTHROPIC_SMALL_FAST_MODEL: selectedSmallModel,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: selectedSmallModel,
        DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
      "claude",
    )

    try {
      clipboard.writeSync(command)
      consola.success("Copied Claude Code command to clipboard!")
    } catch {
      consola.warn(
        "Failed to copy to clipboard. Here is the Claude Code command:",
      )
      consola.log(command)
    }
  }

  // Use DaemonController as lifecycle owner. This centralizes signal handling
  // and graceful shutdown semantics. We pass a small start function so tests
  // can stub server startup if needed.
  const Daemon = (await import("./daemon/controller")).DaemonController

  const controller = new Daemon(
    { port: options.port, shutdownTimeoutMs: 30000 },
    async () => {
      // Start the actual server. We delegate to srvx.serve as before.
      serve({ fetch: server.fetch as ServerHandler, port: options.port })
    },
  )

  // Register a hook to stop background work on shutdown. Individual
  // background tasks should register their own hooks when available.
  // Example: token refresher will add a hook to stop its timer.
  if (
    copilotRefresher
    && typeof (copilotRefresher as any).stop === "function"
  ) {
    controller.registerHook(() => (copilotRefresher as any).stop())
  }

  // Start the controller and await readiness. We await to ensure the CLI
  // only returns after the server is started and `ready` is true.
  try {
    await controller.start()
  } catch (error) {
    consola.error("Failed to start daemon:", error)
    // Ensure non-zero exit for supervisor visibility
    process.exit(1)
  }
}

export const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Copilot API server",
  },
  args: {
    port: {
      alias: "p",
      type: "string",
      default: "5678",
      description: "Port to listen on",
    },
    verbose: {
      alias: "v",
      type: "boolean",
      default: false,
      description: "Enable verbose logging",
    },
    "account-type": {
      alias: "a",
      type: "string",
      default: "individual",
      description: "Account type to use (individual, business, enterprise)",
    },
    manual: {
      type: "boolean",
      default: false,
      description: "Enable manual request approval",
    },
    "rate-limit": {
      alias: "r",
      type: "string",
      description: "Rate limit in seconds between requests",
    },
    wait: {
      alias: "w",
      type: "boolean",
      default: false,
      description:
        "Wait instead of error when rate limit is hit. Has no effect if rate limit is not set",
    },
    "github-token": {
      alias: "g",
      type: "string",
      description:
        "Provide GitHub token directly (must be generated using the `auth` subcommand)",
    },
    "claude-code": {
      alias: "c",
      type: "boolean",
      default: false,
      description:
        "Generate a command to launch Claude Code with Copilot API config",
    },
    "show-token": {
      type: "boolean",
      default: false,
      description: "Show GitHub and Copilot tokens on fetch and refresh",
    },
    "proxy-env": {
      type: "boolean",
      default: false,
      description: "Initialize proxy from environment variables",
    },
    daemon: {
      alias: "d",
      type: "boolean",
      default: false,
      description: "Run in daemon (non-interactive) mode",
    },
    "no-interactive": {
      type: "boolean",
      default: false,
      description: "Disable interactive prompts",
    },
    interactive: {
      type: "boolean",
      default: false,
      description: "Force interactive mode even without a TTY",
    },
  },
  run({ args }) {
    const rateLimitRaw = args["rate-limit"]
    const rateLimit =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rateLimitRaw === undefined ? undefined : Number.parseInt(rateLimitRaw, 10)

    return runServer({
      port: Number.parseInt(args.port, 10),
      verbose: args.verbose,
      accountType: args["account-type"],
      manual: args.manual,
      rateLimit,
      rateLimitWait: args.wait,
      githubToken: args["github-token"],
      claudeCode: args["claude-code"],
      showToken: args["show-token"],
      proxyEnv: args["proxy-env"],
      daemon: args.daemon,
      noInteractive: args["no-interactive"],
      interactive: args.interactive,
    })
  },
})
