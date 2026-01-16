import { test, expect, mock } from "bun:test"

import { state } from "../src/lib/state"
import { setupCopilotToken } from "../src/lib/token"

const fetchMock = mock((_url: string) => {
  return {
    ok: true,
    json: () => ({ token: "abc123", refresh_in: 120 }),
  }
})

// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as any).fetch = fetchMock

test("setupCopilotToken sets state and returns a handle", async () => {
  const handle = await setupCopilotToken()
  expect(state.copilotToken).toBe("abc123")
  expect(handle).toBeTruthy()
  // Ensure handle has stop()
  expect(typeof (handle as any).stop).toBe("function")
  // stop should be callable
  await (handle as any).stop()
})
