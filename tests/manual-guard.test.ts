import { test, expect } from "bun:test"

import { runServer } from "../src/start"

test("runServer rejects when --manual is used in non-interactive/daemon mode", async () => {
  await expect(
    runServer({
      port: 5678,
      verbose: false,
      accountType: "individual",
      manual: true,
      rateLimit: undefined,
      rateLimitWait: false,
      githubToken: "test",
      claudeCode: false,
      showToken: false,
      proxyEnv: false,
      daemon: true, // simulate running as daemon
      noInteractive: false,
      interactive: false,
    }),
  ).rejects.toThrow("Manual approval requires an interactive terminal")
})
