import consola from "consola"
import { serve, type ServerHandler } from "srvx"

import { server, setReadiness, getActiveRequests } from "~/server"

import { writePid, removePid } from "./pid"

import { LifecycleState, DaemonOptions } from "./types"

// Minimal, surgical DaemonController implementing lifecycle owner responsibilities.
// - Owns lifecycle state machine
// - Installs signal handlers (single owner)
// - Exposes start() and stop() for explicit control
// - Allows registration of cleanup hooks

export class DaemonController {
  private state: LifecycleState = "init"
  private shutdownTimeoutMs: number
  private hooks: Array<() => Promise<void> | void> = []
  private forced = false
  private serverHandle: { stop?: () => Promise<void> } | null = null
  private startFn?: (opts: DaemonOptions) => Promise<void>
  // When false, do not call process.exit() after shutdown (useful for tests)
  private exitOnShutdown = true
  // Track whether we wrote a PID file so we can clean it reliably
  private pidWritten = false

  constructor(
    private opts: DaemonOptions,
    startFn?: (opts: DaemonOptions) => Promise<void>,
  ) {
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 30000
    this.exitOnShutdown = opts.exitOnShutdown ?? true

    // startFn can be provided for testing to avoid actually binding a socket during tests
    this.startFn = startFn

    // Install signal handlers here to ensure single owner for shutdown
    // We attach them in constructor so start() can assume handlers exist.
    process.on("SIGTERM", () => this.handleSignal("SIGTERM"))
    process.on("SIGINT", () => this.handleSignal("SIGINT"))
    // Windows support
    // SIGBREAK is emitted by Ctrl+Break on Windows, map it to same handler
    // We also listen for SIGHUP as a conventional reconfigure signal
    // Comments: single owner ensures deterministic shutdown sequence.
    process.on("SIGHUP", () => this.handleSignal("SIGHUP"))
    // SIGBREAK may not exist on some platforms; guard in runtime
    // @ts-expect-error - may not exist on all platforms
    if (typeof (process as any).on === "function") {
      try {
        // @ts-expect-error
        process.on("SIGBREAK", () => this.handleSignal("SIGBREAK"))
      } catch {
        // ignore if not supported
      }
    }

    // Global error handlers: ensure we attempt a controlled shutdown on fatal errors
    process.on("uncaughtException", (err) => {
      consola.error("Uncaught exception, initiating shutdown:", err)
      void this.beginShutdown("fatal")
    })

    process.on("unhandledRejection", (reason) => {
      consola.error("Unhandled rejection, initiating shutdown:", reason)
      void this.beginShutdown("fatal")
    })

    // Ensure PID cleanup on normal exit paths (best-effort for crashes)
    process.on("exit", () => {
      if (this.pidWritten) {
        void removePid()
      }
    })
  }

  // Register a cleanup hook to be called during shutdown
  // Hooks should be idempotent and fast; they can return a Promise
  registerHook(hook: () => Promise<void> | void) {
    this.hooks.push(hook)
  }

  getState() {
    return this.state
  }

  // Start the daemon. Starts server and transitions to ready state.
  // We accept an optional startFn passed in constructor for testability.
  async start(): Promise<void> {
    if (this.state !== "init") {
      throw new Error(`Cannot start from state ${this.state}`)
    }

    this.state = "starting"
    consola.info("Daemon starting...")

    try {
      if (this.startFn) {
        // Testable path: upstream provides a start function
        await this.startFn(this.opts)
      } else {
        // Default: start the actual HTTP listener using srvx
        // We do not keep a reference to an internal srvx handle because
        // srvx.serve does not currently expose a close in this code path.
        // We rely on application-level readiness and draining to prevent
        // new requests and drain in-flight ones before exiting.
        serve({ fetch: server.fetch as ServerHandler, port: this.opts.port })
      }

      // Mark ready after server started
      this.state = "ready"
      setReadiness(true)
      consola.info(`Daemon ready and listening on port ${this.opts.port}`)

      // If running as detached child, write PID only after successful listen
      try {
        if (process.env._COPILOT_DAEMON_CHILD === "1") {
          await writePid(process.pid)
          this.pidWritten = true
          // Register a cleanup hook to remove PID on shutdown
          this.registerHook(async () => {
            await removePid()
          })
        }
      } catch (err) {
        consola.warn("Failed to write PID file:", err)
      }
    } catch (error) {
      this.state = "failed"
      consola.error("Failed to start daemon:", error)
      throw error
    }
  }

  // Handle system signals; ensures single-owner and idempotent behavior
  private handleSignal(signal: string) {
    consola.info("Signal received:", signal)
    if (this.state === "draining") {
      // Second signal => force immediate termination
      consola.warn(
        "Second signal received during shutdown: forcing immediate termination",
      )
      this.forced = true
      // immediate force
      void this.forceTerminate()
      return
    }

    void this.beginShutdown(signal)
  }

  // Begin the graceful shutdown sequence (non-blocking)
  async beginShutdown(reason: string) {
    if (this.state === "stopped") return
    this.state = "draining"

    consola.info("Begin graceful shutdown:", reason)

    // Mark not ready so LBs will stop sending traffic
    setReadiness(false)

    // Stop scheduling new background tasks: callers should respect hooks
    // (hooks should implement their own freeze semantics if needed)

    // Start deadline timer
    const deadline = Date.now() + this.shutdownTimeoutMs

    // Call all registered hooks and wait for them (no more hooks accepted)
    const hookPromises = this.hooks.map(async (h) => {
      try {
        await h()
      } catch (err) {
        consola.warn("Shutdown hook failed:", err)
      }
    })

    // Poll for active requests and hook completions until deadline
    // This ensures we don't accept new work (middleware will reject new requests)
    while (Date.now() < deadline && !this.forced) {
      const active = getActiveRequests()
      if (active === 0) {
        // Wait for hooks to finish as well
        await Promise.allSettled(hookPromises)
        break
      }
      consola.info("Waiting for active requests to finish...", { active })
      // Sleep briefly

      await new Promise((r) => setTimeout(r, 200))
    }

    // If forced flag set or deadline reached, do force terminate
    if (this.forced || Date.now() >= deadline) {
      consola.warn("Shutdown deadline reached or forced; forcing termination")
      await this.forceTerminate()
      return
    }

    // Normal shutdown: cleanup
    consola.info("Shutdown complete")
    try {
      await Promise.allSettled(hookPromises)
    } catch {
      // swallow
    }

    if (this.exitOnShutdown) {
      // Exit with code 0 when permitted
      process.exit(0)
    } else {
      // In test mode we do not exit the process; transition to stopped state
      this.state = "stopped"
      consola.info("Shutdown complete (no exit in test mode)")
    }
  }

  // Force immediate termination: abort sockets and exit non-zero
  private async forceTerminate() {
    // Note: srvx does not expose a cross-platform immediate destroy in this
    // minimal change set. We ensure background hooks are requested to stop
    // and then exit with forced status code.
    try {
      // Attempt to run hooks quickly
      await Promise.allSettled(this.hooks.map((h) => h()))
    } catch {
      // ignore
    }

    // Exit with a deterministic non-zero code (2 -> forced termination)
    if (this.exitOnShutdown) {
      process.exit(2)
    } else {
      this.state = "stopped"
      consola.warn("Forced termination requested (no exit in test mode)")
    }
  }
}
