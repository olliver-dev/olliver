# Goose — Olliver Setup

> **Note:** AI client configurations change frequently. This guide reflects our best knowledge at time of writing but may already be out of date. If these steps don't work, check the official documentation for your client — the core concept (adding Olliver as an MCP server pointed at the `olli` binary) remains the same regardless of where the config lives.

Connect Olliver to Goose by Block so your agent can read, write, and manage capsules.

## Step 1 — Find your Olliver install path

```bash
npm root -g
```

This returns something like `/usr/local/lib/node_modules`. Your Olliver server path is:

```
<result>/olliver/src/index.js
```

## Step 2 — Add the MCP server

Use the Goose CLI to add Olliver as an extension:

```bash
goose configure
```

When prompted, select **Add Extension** and choose **MCP Server (stdio)**. Enter the following:

| Field | Value |
|-------|-------|
| **Name** | `olliver` |
| **Command** | `node /usr/local/lib/node_modules/olliver/src/index.js` |

Replace the path with the actual path from Step 1.

**Alternatively**, edit `~/.config/goose/config.yaml` directly and add Olliver under the `extensions` section:

```yaml
extensions:
  olliver:
    type: stdio
    command: node
    args:
      - /usr/local/lib/node_modules/olliver/src/index.js
    enabled: true
```

Replace the path in `args` with the actual path from Step 1.

## Step 3 — Restart Goose

Start a new Goose session. The extension loads automatically.

## Verify

In a Goose session, ask: **"What capsules do I have?"**

If Olliver is connected, the agent will call `list_capsules` and respond with your Shelf contents.

## Troubleshooting

- **Extension not loading** — Run `goose configure` and verify the extension is listed and enabled. Check that the command path is correct.
- **Shelf not found** — Run `olli status` to verify your Shelf is configured. The server reads `~/.olliver` to find the Shelf path.
