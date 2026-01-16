import fs from "node:fs/promises"
import path from "node:path"

import { PATHS } from "~/lib/paths"

const PID_PATH = path.join(PATHS.APP_DIR, "copilot-proxy-server.pid")

// Validate that a process with the given PID actually exists
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function writePid(pid: number): Promise<void> {
  const tmp = `${PID_PATH}.${process.pid}.tmp`

  // Ensure PID file directory exists
  try {
    await fs.mkdir(path.dirname(PID_PATH), { recursive: true })
  } catch {
    // ignore if already exists
  }

  // Clean up any stale temp files from previous crashes
  try {
    const entries = await fs.readdir(path.dirname(PID_PATH))
    for (const entry of entries) {
      if (entry.endsWith(".tmp") && entry.startsWith("copilot-proxy-server.pid.")) {
        const tmpPath = path.join(path.dirname(PID_PATH), entry)
        try {
          await fs.unlink(tmpPath)
        } catch {
          // ignore if already deleted
        }
      }
    }
  } catch {
    // ignore if directory doesn't exist or other errors
  }

  // Write to temp file with atomic semantics
  try {
    await fs.writeFile(tmp, String(pid), { mode: 0o600 })
  } catch (err) {
    throw new Error(`Failed to write temporary PID file: ${err}`)
  }

  // Atomic rename with retry logic
  let retries = 3
  while (retries > 0) {
    try {
      await fs.rename(tmp, PID_PATH)
      return
    } catch (err) {
      retries--
      if (retries === 0) {
        throw new Error(`Failed to rename PID file after 3 attempts: ${err}`)
      }
      // Retry after brief delay
      await new Promise((r) => setTimeout(r, 50))
    }
  }
}

export async function readPid(): Promise<number | null> {
  try {
    const content = await fs.readFile(PID_PATH, "utf8")
    const pid = Number(content.trim())
    if (Number.isNaN(pid)) return null
    return pid
  } catch {
    return null
  }
}

export async function removePid(): Promise<void> {
  try {
    await fs.unlink(PID_PATH)
  } catch {
    // ignore - it's fine if the file is already gone
  }
}

export { PID_PATH, isProcessAlive }
