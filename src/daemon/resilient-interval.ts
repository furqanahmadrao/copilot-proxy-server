import consola from "consola"

export interface ResilientIntervalHandle {
  stop: () => Promise<void>
}

export interface ResilientIntervalOptions {
  // Maximum backoff in milliseconds
  maxBackoffMs?: number
  // Backoff multiplier
  backoffMultiplier?: number
}

// startResilientInterval runs an async function periodically while guarding
// against unhandled rejections and applying a small backoff on errors.
// The returned handle exposes stop() to cancel future runs.
export function startResilientInterval(
  fn: () => Promise<void>,
  intervalMs: number,
  opts: ResilientIntervalOptions = {},
): ResilientIntervalHandle {
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let consecutiveFailures = 0

  const maxBackoff = opts.maxBackoffMs ?? intervalMs * 10
  const multiplier = opts.backoffMultiplier ?? 2

  async function runOnce() {
    if (stopped) return

    try {
      await fn()
      consecutiveFailures = 0
      scheduleNext(intervalMs)
    } catch (err) {
      consecutiveFailures += 1
      consola.error("Resilient interval function failed:", err)

      // Exponential backoff with cap
      const backoff = Math.min(
        Math.round(intervalMs * Math.pow(multiplier, consecutiveFailures)),
        maxBackoff,
      )
      scheduleNext(backoff)
    }
  }

  function scheduleNext(delay: number) {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(
      () => {
        void runOnce()
      },
      Math.max(0, delay),
    )
  }

  // Start the loop (do not call fn immediately; follow the caller's expected
  // behavior which usually performs an initial fetch before starting the interval)
  scheduleNext(intervalMs)

  return {
    stop: async () => {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
