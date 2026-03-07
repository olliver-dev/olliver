# Windsurf — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to Windsurf by Codeium so your agent can read, write, and manage capsules.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Edit the Windsurf MCP config

Open `~/.codeium/windsurf/mcp_config.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "olliver": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/olliver/src/index.js"]
    }
  }
}
```

Replace the path in `args` with the actual path from Step 1.

A single server entry handles all Environments — no per-Environment configuration needed. The server discovers Environments automatically from the container.

## Step 3 — Restart Windsurf

Restart the editor. The MCP server connects automatically on startup.

## Verify

Open the Cascade AI panel and ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Troubleshooting

- **Tools not appearing** — Verify the config file is valid JSON and the path to `index.js` is correct. Check Windsurf's output logs for MCP errors.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
