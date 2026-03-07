<!-- olliver:managed -->
# MCP Client Reference

## Last Verified
2026-02-21

## Claude Desktop

### Config Location
- macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
- Windows: %APPDATA%\Claude\claude_desktop_config.json
- Linux: ~/.config/Claude/claude_desktop_config.json

### Config Snippet
Add the following to the `mcpServers` object:
```json
"olliver-{environment}": {
  "command": "node",
  "args": ["{path-to-olliver}/src/index.js"],
  "env": {
    "OLLIVER_ENV": ".{environment}"
  }
}
```

### Steps
1. Open the config file at the location above
2. Add the snippet inside the `mcpServers` object
3. Replace `{environment}` with your project name (e.g., `aurora`)
4. Replace `{path-to-olliver}` with the absolute path to the olliver package directory
5. Save the file and restart Claude Desktop

---

## Claude Code

### Config Location
- `~/.claude.json` or `~/.claude/settings.json`
- CLI: `claude mcp add`

### Config Snippet
```json
"olliver-{environment}": {
  "type": "stdio",
  "command": "node",
  "args": ["{path-to-olliver}/src/index.js"],
  "env": {
    "OLLIVER_ENV": ".{environment}"
  }
}
```

### Steps
1. Open your Claude Code config file, or use `claude mcp add`
2. Add the snippet to the `mcpServers` object
3. Replace `{environment}` and `{path-to-olliver}` with your values
4. Restart Claude Code

### WSL Note
If running Claude Code in WSL, all paths must be WSL-native:
- Package: `/mnt/c/Users/{user}/Projects/olliver/src/index.js`
- Shelf: `/mnt/n/Projects/olliver` (or wherever your NAS is mounted)
- Add `"OLLIVER_ROOT": "{wsl-shelf-parent-path}"` to the env block

---

## Cursor

### Config Location
- Global: `~/.cursor/mcp.json`
- Workspace: `.cursor/mcp.json`

### Config Snippet
```json
{
  "mcpServers": {
    "olliver-{environment}": {
      "command": "node",
      "args": ["{path-to-olliver}/src/index.js"],
      "env": {
        "OLLIVER_ENV": ".{environment}"
      }
    }
  }
}
```

### Steps
1. Open `~/.cursor/mcp.json` (create if it doesn't exist)
2. Add the server entry inside `mcpServers`
3. Replace `{environment}` and `{path-to-olliver}` with your values
4. Restart Cursor

---

## VS Code

### Config Location
- Workspace: `.vscode/mcp.json`
- Global: User profile MCP configuration (Command Palette → MCP: Open User Configuration)

### Config Snippet
```json
{
  "mcpServers": {
    "olliver-{environment}": {
      "command": "node",
      "args": ["{path-to-olliver}/src/index.js"],
      "env": {
        "OLLIVER_ENV": ".{environment}"
      }
    }
  }
}
```

### Steps
1. Open `.vscode/mcp.json` in your workspace (or use Command Palette → MCP: Add Server)
2. Add the server entry
3. Replace `{environment}` and `{path-to-olliver}` with your values
4. VS Code will prompt to start the server

---

## OpenAI Codex

### Config Location
- `~/.codex/config.toml`

### Config Snippet
```toml
[mcp_servers.olliver-{environment}]
command = "node"
args = ["{path-to-olliver}/src/index.js"]

[mcp_servers.olliver-{environment}.env]
OLLIVER_ENV = ".{environment}"
```

### Steps
1. Open `~/.codex/config.toml`
2. Add the TOML block above
3. Replace `{environment}` and `{path-to-olliver}` with your values
4. Restart Codex

### Note
Codex uses TOML format, not JSON. The server entry structure differs from other clients.

---

## Windsurf

### Config Location
- `~/.codeium/windsurf/mcp_config.json`

### Config Snippet
```json
{
  "mcpServers": {
    "olliver-{environment}": {
      "command": "node",
      "args": ["{path-to-olliver}/src/index.js"],
      "env": {
        "OLLIVER_ENV": ".{environment}"
      }
    }
  }
}
```

### Steps
1. Open `~/.codeium/windsurf/mcp_config.json`
2. Add the server entry inside `mcpServers`
3. Replace `{environment}` and `{path-to-olliver}` with your values
4. Restart Windsurf

---

## JetBrains IDEs

### Config Location
- Settings → Tools → AI Assistant → Model Context Protocol (MCP)
- Or: Settings → Tools → MCP Server (for JetBrains as MCP server)

### Steps
1. Open Settings → Tools → AI Assistant → MCP
2. Click "Add" to add a new MCP server
3. Select JSON configuration and paste:
```json
{
  "command": "node",
  "args": ["{path-to-olliver}/src/index.js"],
  "env": {
    "OLLIVER_ENV": ".{environment}"
  }
}
```
4. Replace `{environment}` and `{path-to-olliver}` with your values
5. Alternatively, if Claude Desktop is already configured, use "Import from Claude"
6. Restart the IDE
