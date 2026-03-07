# Generic MCP Client — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to any MCP-compatible AI client.

## What you need

Olliver runs as a **stdio MCP server**. Your client needs to launch a Node.js process that communicates over stdin/stdout.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Configure your client

Every MCP client has its own configuration format, but the server definition is the same:

| Field | Value |
|-------|-------|
| **Transport** | stdio |
| **Command** | `node` |
| **Arguments** | `/path/to/olliver/src/index.js` |

In JSON (the most common format):

```json
{
  "command": "node",
  "args": ["/usr/local/lib/node_modules/olliver/src/index.js"]
}
```

Replace the path in `args` with the actual path from Step 1.

A single server entry handles all Environments — no per-Environment configuration needed. The server discovers Environments automatically from the container.

## Step 3 — Restart your client

Most clients require a restart after adding an MCP server.

## Verify

Ask your agent: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Troubleshooting

- **Server not starting** — Ensure Node.js 18+ is installed and in your PATH. Run `node --version` to check.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
- **Tools not available** — Your client may need to explicitly enable MCP tools. Check your client's documentation for MCP support.
