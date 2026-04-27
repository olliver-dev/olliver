# Transports — Stdio and HTTP

Olliver speaks the Model Context Protocol over two transports. Both expose
the same 22 tools with identical semantics. You pick the one that matches
how your client connects.

## Stdio (default)

The classic local pattern. The client (Claude Desktop, Claude Code, Cursor,
JetBrains AI, etc.) spawns `node src/index.js` as a child process and talks
to it over stdin and stdout. No network, no listener, no auth. The transport
lives for the life of the spawned process.

This is the default in v1.0+ and remains unchanged in v1.1. If you set up
Olliver in a stdio-aware client, you do not need to read the rest of this
guide.

## HTTP (new in v1.1)

A network-reachable Streamable HTTP endpoint. Required for clients that
won't (or can't) spawn a local process — most notably ChatGPT custom apps
and hosted agent platforms. Useful for personal LAN setups behind a network
boundary like Tailscale or Cloudflare Access.

### When to use HTTP vs stdio

- **Stdio** is the right answer for ~95% of use cases. It's faster, has no
  network surface, and your client probably already supports it.
- **HTTP** is for clients that demand a URL: ChatGPT, n8n, hosted Claude.ai
  connectors, the Anthropic remote-MCP marketplace, or any setup where you
  want a single Olliver server reachable from multiple machines.

### Starting it

Two ways:

```bash
# Friendly CLI path — defaults to 127.0.0.1:3737/mcp
olli serve

# With overrides
olli serve --port 8080 --host 127.0.0.1 --log-level debug

# Or via env vars (Docker, systemd, anywhere CLI flags are awkward)
OLLIVER_TRANSPORT=http \
OLLIVER_HTTP_PORT=8080 \
OLLIVER_HTTP_HOST=127.0.0.1 \
node node_modules/.bin/olli  # or whatever bin path you use
```

The process runs in the foreground and prints the endpoint URL on startup.
Backgrounding is your responsibility — `systemd`, `pm2`, `docker`, or a
plain `&` work fine. SIGINT and SIGTERM trigger a graceful shutdown.

### Configuration

| Setting | Flag | Env var | Default |
|---|---|---|---|
| Port | `--port` | `OLLIVER_HTTP_PORT` | `3737` |
| Host | `--host` | `OLLIVER_HTTP_HOST` | `127.0.0.1` |
| Path | `--path` | `OLLIVER_HTTP_PATH` | `/mcp` |
| Log level | `--log-level` | `OLLIVER_HTTP_LOG_LEVEL` | `info` |

Precedence: CLI flags override env vars override defaults.

### Health endpoint

`GET /health` returns `200 OK` with `{"status":"ok","version":"<X.Y.Z>"}`.
Cheap, standard, useful for monitoring and container probes.

### Connecting clients

#### Claude Code, Cursor, and other stdio-only clients

These clients want to spawn a local process. To point them at a remote HTTP
Olliver, use the `mcp-remote` bridge — it runs locally and translates stdio
to HTTP. Drop this into your client's MCP config (e.g., `.mcp.json`):

```json
{
  "mcpServers": {
    "olliver": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3737/mcp"]
    }
  }
}
```

`olli serve` prints this exact snippet on startup, with your actual URL.

#### ChatGPT custom apps

ChatGPT requires OAuth on the server. Olliver's OAuth stream is a later
release. Until it ships, two options work:

1. **Place Olliver behind a network boundary** with its own auth — Tailscale,
   Cloudflare Access, an authenticating reverse proxy. ChatGPT connects via
   the boundary's auth, not Olliver's.
2. **Wait for the OAuth stream.** A future version will add OAuth 2.1
   directly so you can install Olliver as a public ChatGPT custom app.

There is no third option that's safe. See the security model below.

#### Other Streamable HTTP clients

Anything that speaks Streamable HTTP can connect directly to the endpoint.
Point the client's "MCP server URL" at `http://<host>:<port><path>`.

## Security model

The HTTP transport ships with conservative defaults and no authentication.
You are responsible for not exposing it to attackers.

**On by default:**

- **Loopback bind.** The default host is `127.0.0.1`. The server is not
  reachable from outside the host machine until you change this.
- **DNS rebinding protection.** Requests with a mismatched `Host` header
  are rejected with 403. This blocks a malicious webpage from hitting
  `localhost:3737` from your browser.
- **Restrictive CORS.** Only the configured host/port origin is allowed.
  No wildcard.
- **No `DELETE /mcp`.** No `GET /mcp` (stateless mode does not need it).

**Your responsibility:**

- **Do not bind to a public IP without auth in front.** Setting
  `OLLIVER_HTTP_HOST=0.0.0.0` exposes the server to anything that can reach
  the port. Without auth, anyone reaching the port can run any Olliver
  tool — including writes (`promote_draft`, `crate_capsule`, `edit_manifest`).
- **Use Tailscale, Cloudflare Access, or a reverse proxy with auth** if you
  need network exposure. The startup banner warns when host is non-loopback.
- **Treat the port as a privileged surface.** Firewall it. Audit access.
  Do not commit `host: 0.0.0.0` to a config file shared across machines.

## Stateless under the hood

The HTTP transport runs in stateless mode (`sessionIdGenerator: undefined`).
Olliver has no per-client server-side state — the Shelf is the API and every
tool call already reads from disk. The transport mints a fresh server per
request, processes it, and tears down. This matches the existing invariant
that files are truth and avoids an entire SDK code path that exists to
manage state Olliver does not have.

One implication: the `promote_draft` per-environment batch counter (which
caps consecutive promotions before requiring a `scan_shelf`) does not carry
across HTTP requests. Tools still work; the rate-limit just doesn't trip.
Stdio retains the in-process counter.

## Troubleshooting

- **`/health` returns but tools fail.** Check that you POST to `/mcp` (or
  your `--path`), not `/`. Set `Accept: application/json, text/event-stream`
  and `Content-Type: application/json`.
- **403 Forbidden on initialize.** A `Host` header mismatch — your client
  is sending a header that's not in the allow list. If you bound to a
  custom hostname, make sure clients use the same name.
- **`olli status` doesn't show the running server.** The probe targets
  `127.0.0.1:3737`. If you're on a custom port or host, the probe skips
  silently — that's by design, not a bug.
- **`olli serve` exits immediately with a port error.** Another process is
  already on the port. Use `--port` to pick a free one.
