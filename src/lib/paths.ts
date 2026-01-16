import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const APP_DIR = path.join(os.homedir(), ".local", "share", "copilot-proxy-server")

const TOKEN_PATH = path.join(APP_DIR, "token.json")

export const PATHS = {
  APP_DIR,
  TOKEN_PATH,
  // Legacy alias for backwards compatibility during migration
  GITHUB_TOKEN_PATH: TOKEN_PATH,
}

export async function ensurePaths(): Promise<void> {
  await fs.mkdir(PATHS.APP_DIR, { recursive: true })
  await ensureFile(PATHS.TOKEN_PATH)
}

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath, fs.constants.W_OK)
  } catch {
    await fs.writeFile(filePath, "")
    await fs.chmod(filePath, 0o600)
  }
}
