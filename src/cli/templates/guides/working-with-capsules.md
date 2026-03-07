# Working with Capsules

Capsules are managed conversationally through your AI client via the MCP server. You don't call tools directly — just ask naturally.

## Common Interactions

- **"What capsules do I have?"** — Agent calls `list_capsules`
- **"Load the product definition"** — Agent Mounts the Capsule to the Rack
- **"Extract capsules from this session"** — Agent runs the extraction workflow
- **"Show me my drafts"** — Agent lists pending drafts
- **"Promote that draft"** — Agent moves the draft to the Shelf and indexes it
- **"Update the to-do draft"** — Agent uses `edit_draft_capsule` to modify in place
- **"What's on the Rack?"** — Agent calls `get_rack`
- **"Unmount everything except the roadmap"** — Agent unmounts selected Capsules
- **"Crate the old API spec"** — Agent archives the Capsule to `crated/`, removes from SHELF.md, adds to CRATE.md
- **"Uncrate the deployment spec"** — Agent restores the Capsule to the Shelf
- **"Check for anything in receiving"** — Agent scans the receiving directory
- **"Run a health check"** — Agent calls `olli_health` for a system snapshot
- **"What's on the shelf index?"** — Agent calls `read_manifest` for SHELF.md
- **"Scan the Shelf for orphans"** — Agent runs `scan_shelf` to detect inconsistencies

## Mounting and Context

Only Mounted Capsules participate in the conversation. Mount what you need, unmount what you don't. The Rack is your active working set.

```
"Mount the API spec and the auth decisions"
"Give me a numbered list of what's on the Rack"
"Unmount 1, 3, and 5"
```

## Extraction Flow

Extraction is the primary way to create Capsules:

1. Ask the agent to extract durable knowledge from your conversation
2. The agent starts an extraction stream and writes drafts
3. You review each draft — promote or reject
4. Promoted drafts become indexed Capsules on the Shelf

```
"Extract what we decided about the data model into a spec capsule"
"Show me the drafts"
"Promote the data model draft"
```
