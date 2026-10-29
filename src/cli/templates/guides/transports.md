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
guide. Stdio also stays available as a break-glass path when Olliver runs as
an HTTP server elsewhere.

## HTTP (new in v1.1)

A network-reachable Streamable HTTP endpoint. Required for clients that
won't (or can't) spawn a local process — ChatGPT, Copilot, Gemini, Grok,
claude.ai connectors, and hosted agent platforms. Also the way to run one
Olliver that several machines share: the HTTP server becomes the only writer
to the Shelf.

### When to use HTTP vs stdio

- **Stdio** is the right answer for a single machine. It's faster, has no
  network surface, and your client probably already supports it.
- **HTTP** is for clients that demand a URL, or for a home server that every
  client — hosted and local — talks to.

### Two doors

Every request to the MCP path must come through one of two doors.

| Door | URL | Credential | Clients |
|---|---|---|---|
| Front | `https://olliver.example.com/mcp` — a Cloudflare Tunnel hostname | `Cf-Access-Jwt-Assertion`, injected by Cloudflare Access after Managed OAuth | ChatGPT, Copilot, Gemini, Grok, claude.ai |
| Side | `http://<olli-lan-ip>:3737/mcp` | `Authorization: Bearer <OLLIVER_LAN_TOKEN>` | Claude Code, Codex, Claude Desktop via `mcp-remote` |

Olliver does not implement OAuth. Cloudflare Access does that at the edge,
then hands Olliver a signed JWT; Olliver verifies the signature (against your
team's Access certs), the issuer, and the audience. The side door is a
long random bearer token for clients on your own network.

Rules:

- **No unauthenticated door.** Binding to anything other than loopback
  without at least one door configured refuses to start.
- **Loopback dev mode.** Bound to `127.0.0.1` with no doors configured,
  every request is allowed — today's local-dev behavior. The banner warns.
- **Once any door is configured, it is enforced everywhere**, loopback
  included.
- `GET /health` is always open and reveals only status and version.

### Starting it

Two ways:

```bash
# Friendly CLI path — defaults to 127.0.0.1:3737/mcp, loopback dev mode
olli serve

# With overrides
olli serve --port 8080 --host 127.0.0.1 --log-level debug

# Or via env vars (Docker, systemd, anywhere CLI flags are awkward)
OLLIVER_TRANSPORT=http \
OLLIVER_HTTP_HOST=192.168.1.50 \
OLLIVER_LAN_TOKEN="$(cat ~/.config/olliver/lan-token)" \
node /path/to/olliver/src/index.js
```

The process runs in the foreground and prints the endpoint URL and the
enabled doors on startup. Backgrounding is your responsibility — `systemd`,
`pm2`, `docker`, or a plain `&` work fine. SIGINT and SIGTERM trigger a
graceful shutdown.

### Configuration

| Setting | Flag | Env var | Default |
|---|---|---|---|
| Port | `--port` | `OLLIVER_HTTP_PORT` | `3737` |
| Host | `--host` | `OLLIVER_HTTP_HOST` | `127.0.0.1` |
| Path | `--path` | `OLLIVER_HTTP_PATH` | `/mcp` |
| Log level | `--log-level` | `OLLIVER_HTTP_LOG_LEVEL` | `info` |
| Side-door token | (env only) | `OLLIVER_LAN_TOKEN` | unset — side door off |
| Access team domain | `--cf-team-domain` | `OLLIVER_CF_TEAM_DOMAIN` | unset — front door off |
| Access AUD tag | `--cf-aud` | `OLLIVER_CF_AUD` | unset — front door off |
| Extra Host values | `--allowed-hosts` | `OLLIVER_HTTP_ALLOWED_HOSTS` | none |
| Environment allowlist | `--expose` | `OLLIVER_EXPOSE` | all environments |

Precedence: CLI flags override env vars override defaults.

- `OLLIVER_LAN_TOKEN` must be at least 32 characters; shorter refuses to
  start. It has no flag so it never lands in shell history or the process
  table. Generate one with `openssl rand -hex 32`.
- `OLLIVER_CF_TEAM_DOMAIN` and `OLLIVER_CF_AUD` come as a pair — setting
  only one refuses to start. The team domain looks like
  `yourteam.cloudflareaccess.com`.
- `OLLIVER_HTTP_ALLOWED_HOSTS` is comma-separated. Each entry is accepted by
  the DNS-rebinding check bare and as `host:port`, and `https://<host>` joins
  the CORS origins.
- `OLLIVER_EXPOSE` is comma-separated and applies to HTTP only. Environments
  not listed behave exactly as if they don't exist: they're missing from
  listings, direct calls return not-found, and `create_environment` refuses
  names outside the list. Stdio always sees every environment.

### Front door: Cloudflare Tunnel + Access

High-level setup. Cloudflare's dashboard is the source of truth for the
exact clicks.

1. **Tunnel.** Run `cloudflared` on a machine that can reach olli. Add a
   public hostname (e.g. `olliver.example.com`) whose service is
   `http://<olli-lan-ip>:3737`.
2. **Access application.** Create a self-hosted Access application for that
   hostname with an Allow policy for your identity. Turn on **Managed
   OAuth** so MCP clients can complete OAuth against Access.
3. **AUD tag.** Copy the application's Application Audience (AUD) tag into
   `OLLIVER_CF_AUD`.
4. **Team domain.** Copy your Zero Trust team domain
   (`yourteam.cloudflareaccess.com`) into `OLLIVER_CF_TEAM_DOMAIN`.
5. **Host allowlist.** Add the public hostname to
   `OLLIVER_HTTP_ALLOWED_HOSTS`. The tunnel forwards the original `Host`
   header, and without this the rebinding check returns 403. If you set an
   HTTP Host Header override on the tunnel's origin, allowlist that value
   instead.
6. **Connect.** In ChatGPT, Copilot, Gemini, Grok, or claude.ai, add the
   connector URL `https://olliver.example.com/mcp`. The client walks you
   through Access sign-in.

Olliver fetches Access's signing keys from
`https://<team>/cdn-cgi/access/certs` (cached by `jose`) and rejects any
JWT that fails signature, issuer, audience, or expiry checks. Any
`Authorization` header on a front-door request is ignored — that's the
client's Access token, not a LAN token.

### Side door: LAN bearer token

Set `OLLIVER_LAN_TOKEN` on the server, then point stdio-only clients at the
LAN URL through the `mcp-remote` bridge (e.g. in `.mcp.json`):

```json
{
  "mcpServers": {
    "olliver": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "http://<olli-lan-ip>:3737/mcp",
        "--allow-http",
        "--header", "Authorization: Bearer ${OLLIVER_LAN_TOKEN}"
      ],
      "env": { "OLLIVER_LAN_TOKEN": "<your LAN token>" }
    }
  }
}
```

- `--allow-http` is required: `mcp-remote` refuses plain HTTP to anything
  other than loopback. Use it only on a network you trust.
- On Windows, Cursor and Claude Desktop don't escape spaces inside `args`.
  Use `"Authorization:${AUTH_HEADER}"` (no space) with
  `"env": { "AUTH_HEADER": "Bearer <your LAN token>" }` instead.
- `olli serve` prints a ready-made snippet with your actual URL.

**Bind address matters.** LAN clients send `Host: <olli-lan-ip>:3737`. If
the server binds to that IP (`OLLIVER_HTTP_HOST=192.168.1.50`), the Host
check accepts it automatically. If you bind to `0.0.0.0`, also add the LAN
IP to `OLLIVER_HTTP_ALLOWED_HOSTS`, or LAN clients get 403.

#### Other Streamable HTTP clients

Anything that speaks Streamable HTTP can connect directly to the endpoint
with the same bearer header.

### Health endpoint

`GET /health` returns `200 OK` with `{"status":"ok","version":"<X.Y.Z>"}`.
Unauthenticated, cheap, standard — useful for monitoring and container
probes. It never reveals Shelf contents.

## Security model

**On by default:**

- **Loopback bind.** The default host is `127.0.0.1`.
- **No unauthenticated door.** A non-loopback bind needs a door or it
  refuses to start.
- **DNS rebinding protection.** Requests whose `Host` header isn't loopback,
  the bind host, or an allowlisted host are rejected with 403. Requests with
  no `Origin` header (server-to-server and CLI clients) pass; browser
  origins must match the allowlist.
- **Restrictive CORS.** Only the configured origins. No wildcard.
- **Path safety on every transport.** Tool arguments that become filesystem
  paths (environment names, filenames, capsule and draft names, stream IDs)
  reject `..`, separators, NUL, and absolute paths, and every joined path is
  checked to stay inside its environment.
- **Single writer.** Writes go to a temp file and rename over the target, so
  readers never see a torn file. Mutating tools are serialized per
  environment, so concurrent clients can't interleave manifest edits.
- **Quiet logs.** Request logs carry method, path, status, latency, door,
  JSON-RPC method, and tool name — never tokens, tool arguments, or capsule
  content.
- **Tool annotations.** Read-only tools carry `readOnlyHint: true`, so
  ChatGPT doesn't ask for confirmation on every read.

**Your responsibility:**

- **Keep the LAN token secret.** Treat it like a password; rotate it by
  changing the env var and restarting.
- **Expose the front door only through Cloudflare.** Don't port-forward
  3737 to the internet — the tunnel is the public path.
- **Use `OLLIVER_EXPOSE`** if some environments shouldn't be reachable from
  hosted clients at all.

## Stateless under the hood

The HTTP transport runs in stateless mode (`sessionIdGenerator: undefined`).
Olliver has no per-client server-side state — the Shelf is the API and every
tool call already reads from disk. The transport mints a fresh server per
request, processes it, and tears down. This matches the existing invariant
that files are truth and avoids an entire SDK code path that exists to
manage state Olliver does not have. The single-writer lock lives at module
scope, so it spans those per-request servers.

One implication: the `promote_draft` per-environment batch counter (which
caps consecutive promotions before requiring a `scan_shelf`) does not carry
across HTTP requests. Tools still work; the rate-limit just doesn't trip.
Stdio retains the in-process counter.

## Troubleshooting

- **401 Unauthorized.** No valid credential. Side door: check the
  `Authorization: Bearer` header and that the token matches exactly. Front
  door: check the AUD tag and team domain; the server log names the
  verification failure code (never the token).
- **`/health` returns but tools fail.** Check that you POST to `/mcp` (or
  your `--path`), not `/`. Set `Accept: application/json, text/event-stream`
  and `Content-Type: application/json`.
- **403 Forbidden.** A `Host` header mismatch. Allowlist the tunnel hostname
  (or LAN IP, if you bound to `0.0.0.0`) in `OLLIVER_HTTP_ALLOWED_HOSTS`.
- **`olli serve` refuses to start.** Read the message: a non-loopback bind
  with no door, a token under 32 characters, or only one of the Cloudflare
  pair set.
- **An environment is missing over HTTP.** It isn't in `OLLIVER_EXPOSE`.
- **`olli status` doesn't show the running server.** The probe targets
  `127.0.0.1:3737`. If you're on a custom port or host, the probe skips
  silently — that's by design, not a bug.
- **`olli serve` exits immediately with a port error.** Another process is
  already on the port. Use `--port` to pick a free one.
