# Zed — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to Zed so your agent can read, write, and manage capsules.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Edit Zed settings

Open Zed's settings with `Cmd+,` (macOS) or `Ctrl+,` (Linux), or use the Command Palette: `zed: open settings`.

Add an `context_servers` entry in your `settings.json`:

```json
{
  "context_servers": {
    "olliver": {
      "command": {
        "path": "node",
        "args": ["/usr/local/lib/node_modules/olliver/src/index.js"]
      }
    }
  }
}
```

Replace the path in `args` with the actual path from Step 1.

## Step 3 — Restart Zed

Save settings and restart Zed. The MCP server will start automatically.

## Verify

Open the Assistant panel and ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Note

Zed uses `context_servers` (not `mcpServers`) in its settings format. The `command.path` field specifies the executable, and `command.args` provides the arguments.

## Troubleshooting

- **Tools not appearing** — Verify the settings JSON is valid. Check that the `context_servers` key is at the top level of your settings. Restart Zed after changes.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
