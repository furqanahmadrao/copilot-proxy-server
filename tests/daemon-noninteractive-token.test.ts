import { test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs/promises"

import { PATHS } from "../src/lib/paths"
import { runServer } from "../src/start"

let originalToken: string | null = null

beforeEach(async () => {
  // Save existing token if any
  try {
    originalToken = await fs.readFile(PATHS.GITHUB_TOKEN_PATH, "utf8")
  } catch {
    originalToken = null
  }
  // Remove token file for test
  try {
    await fs.unlink(PATHS.GITHUB_TOKEN_PATH)
  } catch {
    // ignore
  }
})

afterEach(async () => {
  // Restore original token
  if (originalToken !== null) {
    await fs.writeFile(PATHS.GITHUB_TOKEN_PATH, originalToken)
  }
})

test("runServer rejects when non-interactive and no GitHub token provided", async () => {
  await expect(
    runServer({
      port: 5678,
      verbose: false,
      accountType: "individual",
      manual: false,
      rateLimit: undefined,
      rateLimitWait: false,
      githubToken: undefined,
      claudeCode: false,
      showToken: false,
      proxyEnv: false,
      daemon: true,
      noInteractive: false,
      interactive: false,
    }),
  ).rejects.toThrow(
    "Interactive GitHub auth required but not available in non-interactive mode",
  )
})
