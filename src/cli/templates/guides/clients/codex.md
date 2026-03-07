# OpenAI Codex — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to the OpenAI Codex CLI so your agent can read, write, and manage capsules.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Edit the Codex config

Open `~/.codex/config.toml` (create it if it doesn't exist) and add the Olliver server:

```toml
[mcp_servers.olliver]
command = "node"
args = ["/usr/local/lib/node_modules/olliver/src/index.js"]
```

Replace the path in `args` with the actual path from Step 1.

A single server entry handles all Environments — no per-Environment configuration needed. The server discovers Environments automatically from the container.

## Note

Codex uses TOML format, not JSON. The config structure differs from other MCP clients.

## Step 3 — Restart Codex

Start a new Codex session. The MCP server connects automatically.

## Verify

In a Codex session, ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Troubleshooting

- **Tools not appearing** — Verify the TOML syntax is valid. Check that the path in `args` points to the correct `index.js`.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
