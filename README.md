# Copilot Proxy Server

A local proxy server that exposes GitHub Copilot's API as OpenAI and Anthropic-compatible endpoints, enabling integration with tools like Claude Code and any application supporting standard LLM APIs.

## What It Does

Copilot Proxy Server transforms GitHub Copilot into a local API service compatible with OpenAI's Chat Completions and Anthropic's Messages formats. This enables using GitHub Copilot with development tools and workflows designed for these standard APIs, including Claude Code's conversational AI assistant.

The server runs as a lightweight background daemon, handling authentication, token management, and request translation automatically.

## Why It Exists

GitHub Copilot provides powerful AI capabilities but lacks direct API compatibility with tools expecting OpenAI or Anthropic interfaces. This proxy bridges that gap, allowing developers to:

- Use GitHub Copilot subscriptions with Claude Code
- Integrate Copilot into custom tooling expecting standard LLM APIs
- Leverage existing Copilot access across multiple development workflows
- Maintain a single AI subscription while working with diverse tools

## Prerequisites

- Node.js or Bun runtime
- Active GitHub Copilot subscription (individual, business, or enterprise)

## Installation

Install globally via npm:

```bash
npm install -g copilot-proxy-server
```

This provides the `copilot-proxy` command for managing the server.

## Authentication

Copilot Proxy Server uses GitHub's device code flow for secure authentication.

### First-Time Setup

```bash
copilot-proxy auth
```

This command:
1. Generates a device code
2. Opens your browser to https://github.com/login/device
3. Prompts you to enter the displayed code
4. Exchanges the code for a GitHub access token
5. Stores the token locally for future use

The token is saved to `~/.local/share/copilot-proxy-server/token.json` and persists across server restarts.

### Token Validation

Before starting the server, authentication status is automatically checked. If the token is missing or expired, you'll be prompted to run `copilot-proxy auth` again.

## Running the Server

### Start as Background Daemon

```bash
copilot-proxy start
```

The server:
- Validates your authentication
- Starts on port 5678 by default
- Runs in the background with automatic restarts
- Logs to `~/.local/share/copilot-proxy-server/server.log`
- Stores process ID in `~/.local/share/copilot-proxy-server/copilot-proxy-server.pid`

### Check Server Status

```bash
copilot-proxy status
```

Displays:
- Running state (active/stopped)
- Process ID
- Port number
- Local URL
- Token status (valid/expiring/expired/missing)

### Stop the Server

```bash
copilot-proxy stop
```

Gracefully terminates the background server process.

## CLI Commands

The `copilot-proxy` CLI provides four core commands:

| Command | Description |
|---------|-------------|
| `auth` | Authenticate with GitHub using device code flow |
| `start` | Start the proxy server as a background daemon |
| `stop` | Stop the running background server |
| `status` | Display server status and token information |
| `help` | Show command usage and options |

### Examples

```bash
# First time setup
copilot-proxy auth
copilot-proxy start

# Daily usage
copilot-proxy status    # Check if server is running
copilot-proxy stop      # Stop when not needed
copilot-proxy start     # Restart later

# Re-authenticate when token expires
copilot-proxy auth
```

## Configuration & Storage

### File Locations

All configuration and runtime files are stored in `~/.local/share/copilot-proxy-server/`:

| File | Purpose |
|------|---------|
| `token.json` | Encrypted GitHub access token |
| `copilot-proxy-server.pid` | Server process ID (when running) |
| `server.log` | Server output and error logs |

### Token Management

Tokens are:
- Automatically refreshed when needed
- Validated before each server start
- Checked for expiration in status command
- Displayed with clear state (valid, expiring in <5 minutes, expired, or missing)

If authentication expires, simply run `copilot-proxy auth` to re-authenticate.

## Using with Claude Code

Claude Code is a conversational AI coding assistant that can use this proxy as its backend.

### Setup Steps

1. Start the proxy server:
```bash
copilot-proxy start
```

2. Configure Claude Code environment variables:
```bash
export ANTHROPIC_BASE_URL=http://localhost:5678
export ANTHROPIC_AUTH_TOKEN=dummy
```

3. Launch Claude Code with your preferred model:
```bash
# Claude Code will now use GitHub Copilot through the proxy
```

### Claude Code Settings File

For persistent configuration, create `.claude/settings.json` in your project:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:5678",
    "ANTHROPIC_AUTH_TOKEN": "dummy",
    "ANTHROPIC_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "gpt-4.1",
    "ANTHROPIC_SMALL_FAST_MODEL": "gpt-4.1",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "gpt-4.1"
  }
}
```

This configuration persists across sessions, eliminating the need to set environment variables each time.

More configuration options: [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables)

## API Endpoints

The server exposes standard OpenAI and Anthropic-compatible endpoints:

### OpenAI Format

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Generate chat completions |
| `/v1/models` | GET | List available models |
| `/v1/embeddings` | POST | Generate text embeddings |

### Anthropic Format

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/messages` | POST | Generate message responses |
| `/v1/messages/count_tokens` | POST | Count tokens in messages |

### Utility Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/usage` | GET | View Copilot usage statistics |
| `/token` | GET | Display current access token |

## Examples

### OpenAI Format Request

```bash
curl http://localhost:5678/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Anthropic Format Request

```bash
curl http://localhost:5678/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "gpt-4.1",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 1024
  }'
```

## Troubleshooting

### Server won't start

- Run `copilot-proxy status` to check token state
- Re-authenticate with `copilot-proxy auth` if expired
- Check logs at `~/.local/share/copilot-proxy-server/server.log`

### Port already in use

The default port (5678) may be occupied. Stop other services using this port or wait for the previous server instance to fully terminate.

### Authentication fails

- Ensure you have an active GitHub Copilot subscription
- Check your internet connection
- Complete the device code flow within the time limit (typically 15 minutes)

## License

MIT

## Disclaimer

This project provides a proxy interface to GitHub Copilot's API. It is not officially supported by GitHub and may change or break without notice. Use responsibly and in accordance with GitHub's terms of service.
