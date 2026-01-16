import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { completionRoutes } from "./routes/chat-completions/route"
import { embeddingRoutes } from "./routes/embeddings/route"
import { messageRoutes } from "./routes/messages/route"
import { modelRoutes } from "./routes/models/route"
import { tokenRoute } from "./routes/token/route"
import { usageRoute } from "./routes/usage/route"

export const server = new Hono()

server.use(logger())
server.use(cors())

// Readiness flag used by the daemon controller to indicate live/ready state
let ready = true
export function setReadiness(value: boolean) {
  ready = value
}

// Active requests counter for graceful shutdown draining
let activeRequests = 0
export function getActiveRequests() {
  return activeRequests
}

// Simple middleware to track active requests. This is lightweight and does
// not modify request logic; it ensures the controller can wait for in-flight
// requests to complete before exiting.
server.use(async (c, next) => {
  // If not ready, reject early to avoid starting new work when draining
  if (!ready) {
    return c.text("Server is shutting down", 503)
  }

  activeRequests += 1
  try {
    await next()
  } finally {
    activeRequests -= 1
  }
})

server.get("/", (c) => c.text("Server running"))

server.route("/chat/completions", completionRoutes)
server.route("/models", modelRoutes)
server.route("/embeddings", embeddingRoutes)
server.route("/usage", usageRoute)
server.route("/token", tokenRoute)

// Compatibility with tools that expect v1/ prefix
server.route("/v1/chat/completions", completionRoutes)
server.route("/v1/models", modelRoutes)
server.route("/v1/embeddings", embeddingRoutes)

// Anthropic compatible endpoints
server.route("/v1/messages", messageRoutes)

// Admin endpoint for graceful shutdown
server.post("/admin/shutdown", async (c) => {
  // Only allow shutdown from localhost
  const host = c.req.header("host") || ""
  if (!host.startsWith("localhost:") && !host.startsWith("127.0.0.1:")) {
    return c.text("Forbidden", 403)
  }

  // Mark server as shutting down
  setReadiness(false)

  // Schedule exit outside the request context to avoid UV handle errors
  setTimeout(() => {
    process.exit(0)
  }, 100)

  return c.json({ message: "Shutting down gracefully" })
})
