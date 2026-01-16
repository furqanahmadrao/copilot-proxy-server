import fs from "node:fs/promises"
import path from "node:path"

import { PATHS } from "~/lib/paths"

const PID_PATH = path.join(PATHS.APP_DIR, "copilot-api.pid")

export async function writePid(pid: number): Promise<void> {
  const tmp = `${PID_PATH}.${process.pid}.tmp`
  await fs.writeFile(tmp, String(pid), { mode: 0o600 })
  await fs.rename(tmp, PID_PATH)
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
    // ignore
  }
}

export { PID_PATH }
