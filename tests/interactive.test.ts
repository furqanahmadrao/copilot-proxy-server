import { test, expect } from "bun:test"

import {
  computeInteractive,
  assertInteractiveOrThrow,
} from "../src/lib/interactive"

const originalIsTTY = (process.stdin as any)?.isTTY

function setIsTTY(value: boolean | undefined) {
  // @ts-expect-error modifying for test
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  })
}

test("computeInteractive respects forceInteractive", () => {
  setIsTTY(false)
  expect(computeInteractive({ forceInteractive: true })).toBe(true)
})

test("computeInteractive returns false when daemon or noInteractive set", () => {
  setIsTTY(true)
  expect(computeInteractive({ daemon: true })).toBe(false)
  expect(computeInteractive({ noInteractive: true })).toBe(false)
})

test("computeInteractive returns TTY state by default", () => {
  setIsTTY(true)
  expect(computeInteractive({})).toBe(true)
  setIsTTY(false)
  expect(computeInteractive({})).toBe(false)
})

test("assertInteractiveOrThrow throws when not interactive", () => {
  setIsTTY(false)
  expect(() => assertInteractiveOrThrow({})).toThrow()
})

// Restore original state
Object.defineProperty(process.stdin, "isTTY", {
  value: originalIsTTY,
  configurable: true,
})
