# JetBrains — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to JetBrains IDEs (IntelliJ IDEA, PHPStorm, WebStorm, PyCharm, and others) so your agent can read, write, and manage capsules.

## Prerequisites

- A JetBrains IDE with AI Assistant support (2024.3+)
- The AI Assistant plugin enabled (bundled with most JetBrains IDEs)
- Node.js 18+ installed

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Add the MCP server

1. Open **Settings** → **Tools** → **AI Assistant** → **Model Context Protocol (MCP)**
2. Click **+ Add** to add a new MCP server
3. Set the server type to **Stdio**
4. Enter the configuration:

| Field | Value |
|-------|-------|
| **Name** | `olliver` |
| **Command** | `node` |
| **Arguments** | `/usr/local/lib/node_modules/olliver/src/index.js` |

Replace the arguments path with the actual path from Step 1.

**Alternatively**, paste this JSON when prompted for configuration:

```json
{
  "command": "node",
  "args": ["/usr/local/lib/node_modules/olliver/src/index.js"]
}
```

**Import shortcut:** If Claude Desktop is already configured with Olliver, click **Import from Claude Desktop** to copy the server entry automatically.

## Step 3 — Restart the IDE

Restart your JetBrains IDE. The MCP server will connect on startup.

## Verify

Open the AI Assistant chat and ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Supported IDEs

MCP support is available in all JetBrains IDEs with AI Assistant:
- IntelliJ IDEA (Ultimate)
- PHPStorm
- WebStorm
- PyCharm (Professional)
- GoLand
- Rider
- RubyMine
- CLion

Community editions may have limited AI Assistant support. Check your IDE version for MCP availability.

## Troubleshooting

- **MCP option not visible** — Ensure you are on JetBrains 2024.3+ and the AI Assistant plugin is enabled. Check **Settings → Plugins** to verify.
- **Tools not appearing** — Verify the path to `index.js` is correct. Check the IDE's event log for MCP connection errors.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
