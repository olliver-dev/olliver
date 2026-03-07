# Shelf Lifecycle

Capsules move through four stages:

```
Receiving → Drafts → Shelf → Crated
```

## Two Paths to the Shelf

### Extraction — The Primary Path
During a conversation, ask your AI agent to extract durable knowledge. The agent starts an extraction stream, writes draft Capsules to `drafts/`, and presents them for your review. Approved drafts are promoted to the Shelf and indexed in SHELF.md.

### Receiving — For External Files
Drop documents, notes, or references into `receiving/`. Ask the agent to scan and triage them. The agent classifies each file and stages it as a draft Capsule for review and promotion.

## Stages

### 1. Receiving
Intake. Raw files awaiting triage in `receiving/`. These are external files you want your agent to process — PDFs, markdown notes, reference documents.

### 2. Drafts
Review. Drafts (`.draft.md`) live in `drafts/`. They are invisible to `list_capsules` until promoted. Drafts are mutable — use `edit_draft_capsule` to update them in place before promotion.

### 3. Shelf
Active. Promoted Capsules (`.context.md`) live in `shelf/` and are indexed in SHELF.md. They are searchable, mountable to the Rack, and available for all agents.

### 4. Crated
Archived. When a Capsule is superseded or no longer active, it moves to `crated/` with a timestamped filename (e.g., `api-design-1741193400.crate.md`). Crated Capsules are indexed in CRATE.md and can be restored to the Shelf at any time.
