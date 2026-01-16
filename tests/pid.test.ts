import { test, expect } from "bun:test"

import { writePid, readPid, removePid } from "../src/daemon/pid"

test("pid file lifecycle", async () => {
  await writePid(12345)
  const pid = await readPid()
  expect(pid).toBe(12345)
  await removePid()
  const pid2 = await readPid()
  expect(pid2).toBeNull()
})
