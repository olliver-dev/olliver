<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://olliver.dev/assets/images/olliver-logo-nav-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://olliver.dev/assets/images/olliver-logo-nav.png">
    <img src="https://olliver.dev/assets/images/olliver-logo-nav.png" alt="Olliver" width="450">
  </picture>
</p>

<h1 align="center">
  <strong>Portable context for AI collaboration.</strong>
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/olliver"><img src="https://img.shields.io/npm/v/olliver" alt="npm version" /></a>
  <a href="https://github.com/olliver-dev/olliver/wiki"><img src="https://img.shields.io/badge/docs-wiki-blue" alt="Documentation" /></a>
  <a href="https://olliver.dev"><img src="https://img.shields.io/badge/web-olliver.dev-orange" alt="Website" /></a>
</p>

---

Olliver is a filesystem-first context vessel that lets you maintain project knowledge across any MCP-compatible AI client. Your context lives on your filesystem as structured markdown files — not locked inside any vendor's memory.

Switch between Claude, Cursor, VS Code, ChatGPT, or any MCP client. Your context follows you.

## The Problem

AI collaboration produces valuable knowledge — architecture decisions, project context, domain understanding. But that knowledge gets trapped:

- Claude's memory lives inside Claude
- Cursor's context lives inside Cursor
- ChatGPT's memory lives inside ChatGPT

Switch tools, and you start over. Olliver solves this by storing context where every tool can reach it: your filesystem.

## How It Works

Olliver stores durable knowledge as **Capsules** — structured markdown files organized on a **Shelf**. An MCP server exposes 22 tools that let AI agents read, write, and manage your context conversationally.

```
You: "Extract what we decided about the API into a spec capsule"
Agent: [begins extraction → writes draft → presents for review]
You: "Looks good — shelf it"
Agent: [promotes draft to Shelf, indexes in SHELF.md]
```

Next session — or a completely different AI client:

```
You: "Mount the API spec"
Agent: [loads capsule into context]
You: "Given our API decisions, how should we handle auth?"
Agent: [responds with full awareness of your prior decisions]
```

## Quick Start

```bash
# Install
npm install -g olliver

# Set up your Shelf
olli install

# Connect your AI client
olli client
```

Then open your AI client and try:

```
"What capsules do I have?"
"Run a health check"
```

## Core Concepts

| Concept | What It Is |
|---------|-----------|
| **Container** | The `.olli/` directory — holds everything |
| **Capsule** | A `.context.md` file — one unit of durable knowledge |
| **Shelf** | Where active Capsules live (`shelf/`) |
| **Rack** | The set of Capsules currently loaded into context |
| **Environment** | An isolated context boundary for a project |
| **Crate** | Archive for retired Capsules — preserved, never deleted |

Capsules flow through a lifecycle:

```
Receiving → Drafts → Shelf → Crated
```

## Supported Clients

Olliver works with any MCP-compatible client. Tested and documented:

| Client | Config Format |
|--------|--------------|
| Claude Desktop | JSON (`claude_desktop_config.json`) |
| Claude Code | JSON or `claude mcp add` CLI |
| VS Code | JSON (built-in MCP, Continue, or Cline) |
| Cursor | JSON |
| Windsurf | JSON (`mcp_config.json`) |
| JetBrains IDEs | Settings UI or JSON |
| Zed | JSON (`context_servers` in settings) |
| ChatGPT | JSON |
| OpenAI Codex | TOML (`config.toml`) |
| Goose | YAML or `goose configure` CLI |

All clients use the same server definition — a single entry handles all Environments:

```json
{
  "command": "node",
  "args": ["/path/to/global/node_modules/olliver/src/index.js"]
}
```

Find your path: `npm root -g`

## MCP Tools (22)

| Group | Tools |
|-------|-------|
| **Context** | `list_capsules`, `read_capsule`, `mount_capsule`, `unmount_capsule`, `get_rack` |
| **Extraction** | `begin_extraction`, `write_pass_output`, `write_draft_capsule`, `edit_draft_capsule`, `list_drafts`, `promote_draft`, `reject_draft` |
| **Receiving** | `scan_receiving`, `stage_source` |
| **Manifest** | `read_manifest`, `edit_manifest` |
| **Crating** | `crate_capsule`, `uncrate_capsule` |
| **Environment** | `create_environment` |
| **Health** | `olli_health`, `scan_shelf` |
| **Help** | `get_help` |

Full reference: [MCP Tools Reference](https://github.com/olliver-dev/olliver/wiki/MCP-Tools-Reference)

## CLI

```bash
olli install     # Set up your Shelf
olli status      # Dashboard — Capsules, Rack, Drafts across all Environments
olli client      # Interactive MCP client setup guide
olli help        # Interactive operational guide browser
```

Capsule management happens conversationally through your AI client, not the CLI.

## Architecture

- **Filesystem is truth** — plain markdown files, no database, no proprietary format
- **Stateless package** — upgrading Olliver never touches your data
- **Single server, all Environments** — one MCP registration discovers everything
- **Self-teaching agents** — interaction patterns delivered via MCP handshake
- **Model-agnostic** — works with any client that speaks MCP

```
.olli/                          Container
├── .my-project/                Environment
│   ├── SHELF.md                Capsule index
│   ├── RACK.md                 Rack state (mounted Capsules)
│   ├── shelf/                  Active Capsules (flat)
│   ├── drafts/                 Pending drafts
│   ├── receiving/              Incoming files
│   ├── extractions/            Stream working directories
│   └── crated/
│       └── CRATE.md            Archive index
└── .another-project/
    └── [same structure]
```

## Requirements

- Node.js 18+
- An MCP-compatible AI client

## Documentation

- **[Wiki](https://github.com/olliver-dev/olliver/wiki)** — full documentation, guides, and tool reference
- **[olliver.dev](https://olliver.dev)** — overview and early access signup
- **`olli help`** — built-in guide browser (works offline)

## Early Access

Olliver is in early access. Install globally:

```bash
npm install -g olliver
```

We're actively developing and would love feedback. [Sign up for updates](https://olliver.dev/#get-on-the-list) or open an issue.

---

<p align="center">
  <em>It's Olliver, but you can call him Olli.</em>
</p>
