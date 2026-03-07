# Common Workflows

## Extracting Context from a Conversation

Ask your AI agent to extract durable knowledge from the current session:

1. The agent starts an extraction stream (`begin_extraction`)
2. Writes draft Capsules to `drafts/` (`write_draft_capsule`)
3. Presents drafts for your review — promote (`promote_draft`) or reject (`reject_draft`) each one
4. Promoted Capsules land on the Shelf and are indexed in SHELF.md

## Managing the Rack

The Rack is your active context working set:

- **Mount** a Capsule to load it into context for the current session
- **Unmount** when it's no longer needed — keeps context lean
- **Get Rack** to see what's currently loaded

The Rack persists across conversations via RACK.md. Capsules stay Mounted until you unmount them.

## Receiving External Files

Drop any file into `receiving/`:

1. Ask your agent to scan receiving (`scan_receiving`)
2. The agent previews and classifies each file
3. Stage files as draft Capsules (`stage_source`)
4. Review and promote as usual

## Archiving Capsules

When a Capsule is superseded or no longer active:

1. Ask the agent to crate it (`crate_capsule`)
2. The Capsule moves to `crated/` with a timestamped filename
3. SHELF.md entry is removed, CRATE.md entry is created
4. To restore later: ask the agent to uncrate it (`uncrate_capsule`)

Crated Capsules are never deleted — they're preserved for lineage and can be restored at any time.

## Checking System Health

- **Quick check:** "Run a health check" — calls `olli_health` for version, Rack state, Shelf counts, and coverage across all Environments
- **Shelf scan:** "Scan the Shelf" — calls `scan_shelf` for detailed coverage, consistency, or full integrity scan
- **Orphans** — files on disk with no Manifest entry
- **Phantoms** — Manifest entries with no file on disk
- **Clean** — zero orphans and zero phantoms

## Browsing Manifests

Read any Manifest to see what's indexed:

- "What's on the Shelf index?" — `read_manifest({ manifest: "shelf" })`
- "Show me the Crate log" — `read_manifest({ manifest: "crate" })`
- "What's on the Rack?" — `get_rack` or `read_manifest({ manifest: "rack" })`

## Editing Drafts

Drafts are mutable before promotion:

- **Create:** `write_draft_capsule` — creates a new draft
- **Edit:** `edit_draft_capsule` — full content replacement of an existing draft
- **Collision:** If a draft with the same name exists, `write_draft_capsule` offers overwrite, rename, or edit options
