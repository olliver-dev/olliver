# CLI Commands

## Global Options

```
-v, --version         Show version
-q, --quiet           Suppress non-essential output
--no-ansi             Disable colored output
--no-interaction      Skip all interactive prompts
```

## Commands

### olli install

Set up a new Shelf.

```
olli install
  --shelf <path>        Shelf location (default: current directory)
  --no-interaction      Skip prompts (create with defaults)
```

Creates the Container, Environment, directory structure, and Manifests.

### olli client

Display MCP client setup guides.

```
olli client
  --no-interaction      List available clients without interactive menu
```

Shows an interactive menu of supported AI clients. Select a client to view its MCP server configuration guide. The client list is derived from guide files — new clients appear automatically when a guide is added.

### olli status

Show Shelf state, Rack, and pending drafts.

```
olli status
```

Displays version (with upgrade check), Container path, and per-Environment counts: Capsules, Rack, Crated, Receiving, and Drafts. For detailed Shelf or Rack contents, ask your agent (e.g., "What's on the Shelf?" or "What's on the Rack?").

### olli help

Display Olliver usage guide.

```
olli help
  --no-interaction      Render all guides without interactive menu
```

Shows an interactive topic menu of operational guides. Select a topic to read it, or choose "Show All" to render everything.
