export interface InteractiveOptions {
  daemon?: boolean
  noInteractive?: boolean
  forceInteractive?: boolean
}

export const isTTY = (): boolean => {
  try {
    // process.stdin can be undefined in some runtimes; guard access
    // @ts-expect-error - some runtimes have different types
    return Boolean(process.stdin && (process.stdin as any).isTTY)
  } catch {
    return false
  }
}

// Compute whether the application should run interactively.
// Priority: forceInteractive -> explicit daemon/no-interactive -> TTY detection
export const computeInteractive = (opts: InteractiveOptions = {}): boolean => {
  if (opts.forceInteractive) return true
  if (opts.daemon || opts.noInteractive) return false
  return isTTY()
}

export function assertInteractiveOrThrow(
  opts: InteractiveOptions,
  message?: string,
): void {
  if (!computeInteractive(opts)) {
    throw new Error(message ?? "Interactive mode required but not available")
  }
}
