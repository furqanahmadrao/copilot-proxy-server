import { test, expect } from "bun:test"

import { startResilientInterval } from "../src/daemon/resilient-interval"

test("resilient interval retries on failures and can be stopped", async () => {
  let calls = 0
  const results: Array<number> = []

  const fn = async () => {
    calls += 1
    results.push(calls)
    if (calls < 3) {
      throw new Error("transient")
    }
    // otherwise succeed
  }

  const handle = startResilientInterval(fn, 20, { maxBackoffMs: 200 })

  // wait enough time for a few attempts (backoff increases on failures)
  await new Promise((r) => setTimeout(r, 400))

  // At least 3 calls should have happened (2 failures, 1 success)
  expect(calls).toBeGreaterThanOrEqual(3)

  // Now stop and ensure no further calls after a short wait
  await handle.stop()
  const prev = calls
  await new Promise((r) => setTimeout(r, 100))
  expect(calls).toBe(prev)
})
