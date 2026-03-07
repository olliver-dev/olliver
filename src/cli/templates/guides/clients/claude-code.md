# Claude Code — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to Claude Code so your agent can read, write, and manage capsules.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Add the MCP server

The quickest way is the `claude mcp add` command:

```bash
claude mcp add olliver -s user -- node /usr/local/lib/node_modules/olliver/src/index.js
```

Replace the path with the actual path from Step 1. The `-s user` flag makes it available globally across all projects.

**Alternatively**, edit `~/.claude/settings.json` directly and add to the `mcpServers` object:

```json
"olliver": {
  "type": "stdio",
  "command": "node",
  "args": ["/usr/local/lib/node_modules/olliver/src/index.js"]
}
```

A single server entry handles all Environments — no per-Environment configuration needed. The server discovers Environments automatically from the container.

## Step 3 — Restart Claude Code

Exit and reopen Claude Code, or start a new session.

## Verify

In a Claude Code session, ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## WSL Note

If running Claude Code in WSL, all paths must be WSL-native (e.g., `/mnt/c/Users/you/...`). Ensure the path in your config points to the WSL filesystem, not Windows paths.

## Troubleshooting

- **Tools not appearing** — Run `claude mcp list` to verify the server is registered. Check that the path in `args` is correct.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
