import { test, expect } from "bun:test"

import { writePid, readPid, removePid, isProcessAlive } from "../src/daemon/pid"

test("pid file lifecycle", async () => {
  // Use current process PID (which definitely exists)
  const currentPid = process.pid

  await writePid(currentPid)
  const pid = await readPid()
  expect(pid).toBe(currentPid)

  // Verify isProcessAlive works
  const alive = await isProcessAlive(currentPid)
  expect(alive).toBe(true)

  // Verify non-existent PID returns false
  const deadPid = 99999
  const deadAlive = await isProcessAlive(deadPid)
  expect(deadAlive).toBe(false)

  await removePid()
  const pid2 = await readPid()
  expect(pid2).toBeNull()

  // Test with non-existent PID in file: readPid should still return it
  // (validation happens in the CLI commands, not in readPid itself)
  await writePid(99999)
  const pid3 = await readPid()
  expect(pid3).toBe(99999)

  // Clean up
  await removePid()
})


