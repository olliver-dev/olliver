# Generic MCP Client — Olliver Setup Guide

## Prerequisites
- An MCP-compatible client
- Node.js 18+ installed
- Olliver installed globally (`npm install -g olliver`)
- Shelf set up (`olli install`)

## How It Works

Olliver runs as an MCP server that communicates over stdio. Your MCP client launches the server process and communicates with it using the Model Context Protocol.

## Server Entry Point

```
node /path/to/global/node_modules/olliver/src/index.js
```

Find the global install path:
```bash
npm root -g
```

## Environment Discovery

The server discovers all Environments automatically from the container directory. No environment variables are needed — a single server entry handles all Environments.

The server reads `~/.olliver` to find the Shelf path.

## MCP Tools Exposed (22 tools)

The server exposes these tools:

**Context Management:**
- `list_capsules` — Discover available Capsules
- `read_capsule` — Read Capsule content
- `mount_capsule` — Add Capsule to Rack
- `unmount_capsule` — Remove Capsule from Rack
- `get_rack` — Show current Rack state

**Extraction:**
- `begin_extraction` — Start extraction session
- `write_pass_output` — Write intermediate analysis
- `write_draft_capsule` — Create draft Capsule
- `edit_draft_capsule` — Edit an existing draft Capsule
- `list_drafts` — Show pending drafts
- `promote_draft` — Promote draft to Shelf
- `reject_draft` — Reject draft with reason

**Receiving:**
- `scan_receiving` — Scan the receiving area for staged sources
- `stage_source` — Stage a source for extraction

**Manifest:**
- `read_manifest` — Read the Shelf Manifest
- `edit_manifest` — Edit a Manifest entry

**Crating:**
- `crate_capsule` — Archive a Capsule to the crate
- `uncrate_capsule` — Restore a Capsule from the crate

**Health & Integrity:**
- `olli_health` — System health snapshot
- `scan_shelf` — Shelf integrity scanner

**Environment:**
- `create_environment` — Create a new Environment

## Verification

Once connected, ask your AI client:
- "What capsules do I have?"
- "Show me my rack"

## Troubleshooting

**Server not starting:**
- Verify Node.js is installed: `node --version`
- Verify Olliver is installed: `olli --version`
- Check the server path is correct

**Shelf not found:**
- Run `olli status` to verify configuration
- The server reads `~/.olliver` for the Shelf path
