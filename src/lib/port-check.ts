import net from "node:net"

/**
 * Check if a port is already in use by attempting to connect to it
 */
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()

    const onError = () => {
      socket.destroy()
      resolve(false) // Port is not in use (connection failed)
    }

    const onConnect = () => {
      socket.destroy()
      resolve(true) // Port is in use (connection succeeded)
    }

    socket.setTimeout(1000)
    socket.once("error", onError)
    socket.once("timeout", onError)
    socket.connect(port, "127.0.0.1", onConnect)
  })
}

/**
 * Send a shutdown request to the server
 */
export async function sendShutdownRequest(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/admin/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}
