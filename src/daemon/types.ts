export type LifecycleState =
  | "init"
  | "starting"
  | "ready"
  | "draining"
  | "stopped"
  | "failed"

export interface DaemonOptions {
  port: number
  shutdownTimeoutMs?: number
  // When true, the controller will call process.exit at the end of shutdown.
  // For testing, this can be set to false to avoid terminating the test runner.
  exitOnShutdown?: boolean
}
