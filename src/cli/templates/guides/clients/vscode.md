# VS Code — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to VS Code using its built-in MCP support, the Continue extension, or the Cline extension so your agent can read, write, and manage capsules.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Option A — VS Code Built-in MCP (v1.99+)

Create or edit `.vscode/mcp.json` in your workspace:

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

Or use the Command Palette: `MCP: Add Server` → Stdio → follow the prompts.

Replace the path in `args` with the actual path from Step 1.

**Restart:** VS Code will prompt you to start the MCP server when it detects the config. Click **Start** or reload the window.

## Option B — Continue Extension

Install the [Continue](https://marketplace.visualstudio.com/items?itemName=Continue.continue) extension if you haven't already.

Open `~/.continue/config.json` and add to the `mcpServers` array:

```json
{
  "mcpServers": [
    {
      "name": "olliver",
      "command": "node",
      "args": ["/usr/local/lib/node_modules/olliver/src/index.js"]
    }
  ]
}
```

Replace the path in `args` with the actual path from Step 1.

**Restart:** Reload the VS Code window after saving.

## Option C — Cline Extension

Install the [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) extension if you haven't already.

1. Open the Cline sidebar panel
2. Click the **MCP Servers** icon (plug icon) in the top toolbar
3. Click **Configure MCP Servers** to open `cline_mcp_settings.json`
4. Add Olliver to the `mcpServers` object:

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

**Restart:** Cline detects changes automatically. If tools don't appear, toggle the server off and on in the MCP Servers panel.

## Verify

Open your AI chat panel (Copilot Chat, Continue, or Cline) and ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Troubleshooting

- **Tools not appearing** — Check the MCP server status in the Output panel (select "MCP" from the dropdown). Verify the path to `index.js` is correct.
- **Cline tools not loading** — Open the MCP Servers panel and check the server status indicator. Click the refresh icon to restart the server.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
