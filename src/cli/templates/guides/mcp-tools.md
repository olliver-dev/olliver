# MCP Tools

The Olliver MCP server exposes 22 tools for AI agents. You interact with these conversationally — ask your AI client naturally and it calls the appropriate tools.

All scoped tools accept an optional `environment` parameter. If omitted and multiple Environments exist, the server returns a numbered list for you to choose from. If only one Environment exists, it is selected automatically.

## Context Tools

| Tool | Purpose |
|---|---|
| `list_capsules` | List all Capsules on the Shelf with metadata |
| `read_capsule` | Read the full content of a Capsule |
| `mount_capsule` | Mount a Capsule to the Rack (load into context) |
| `unmount_capsule` | Unmount a Capsule from the Rack |
| `get_rack` | Show all currently Mounted Capsules |

## Extraction Tools

| Tool | Purpose |
|---|---|
| `begin_extraction` | Start a new extraction stream |
| `write_pass_output` | Write intermediate analysis to the stream |
| `write_draft_capsule` | Create a draft Capsule (handles collisions via `if_exists`) |
| `edit_draft_capsule` | Update an existing draft in place |
| `list_drafts` | List pending drafts, optionally filtered by category |
| `promote_draft` | Promote a draft to the Shelf |
| `reject_draft` | Reject a draft with a reason |

## Receiving Tools

| Tool | Purpose |
|---|---|
| `scan_receiving` | Scan incoming files in `receiving/` |
| `stage_source` | Classify and stage a received file as a draft |

## Manifest Tools

| Tool | Purpose |
|---|---|
| `read_manifest` | Read and parse SHELF.md, RACK.md, or CRATE.md |
| `edit_manifest` | Add, update, or remove entries in any Manifest |

## Crating Tools

| Tool | Purpose |
|---|---|
| `crate_capsule` | Archive a Capsule from Shelf to Crate (writes CRATE.md, removes SHELF.md entry) |
| `uncrate_capsule` | Restore a Crated Capsule to the Shelf (removes CRATE.md entry) |

## Environment Tools

| Tool | Purpose |
|---|---|
| `create_environment` | Create a new Environment in the Container |

## Health Tools

| Tool | Purpose |
|---|---|
| `olli_health` | System health snapshot across all Environments |
| `scan_shelf` | Integrity scan — coverage, consistency, or full |

## Help Tools

| Tool | Purpose |
|---|---|
| `get_help` | Browse and read Olliver guides and documentation |
