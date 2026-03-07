# Claude Desktop — Olliver Setup Guide

## Prerequisites
- Claude Desktop installed
- Node.js 18+ installed
- Olliver installed globally (`npm install -g olliver`)
- Shelf set up (`olli install`)

## Configuration

1. Open Claude Desktop
2. Go to **Settings → Developer → Edit Config** (or open `claude_desktop_config.json` directly)
3. Add the Olliver MCP server to the `mcpServers` section:

```json
{
  "mcpServers": {
    "olliver": {
      "command": "node",
      "args": ["/path/to/global/node_modules/olliver/src/index.js"]
    }
  }
}
```

**Finding the global install path:**
```bash
npm root -g
# Returns something like: /usr/local/lib/node_modules
# Your args path would be: /usr/local/lib/node_modules/olliver/src/index.js
```

A single server entry handles all Environments — no per-Environment configuration needed. The server discovers Environments automatically from the container.

4. Restart Claude Desktop

## Verification

Start a new conversation and ask:
- "What capsules do I have?"
- "Show me my rack"

If Olliver is connected, the agent will use the MCP tools to answer.

## Troubleshooting

**Tools not appearing:**
- Check that the path in `args` points to the correct `index.js`
- Ensure Node.js is in your system PATH
- Restart Claude Desktop after config changes

**Shelf not found:**
- Run `olli status` to verify your Shelf is configured
- The server reads `~/.olliver` to find the Shelf path
