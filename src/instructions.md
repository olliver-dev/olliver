# Olliver Interaction Patterns

## Core Principle

**Users shouldn't feel like they're managing context.**

When a user asks about something, the assistant should:
1. Check if relevant Capsules are Mounted
2. Discover available Capsules if needed
3. Offer to hydrate (not ask for permission to search)
4. Mount + summarize in one flow

---

## Interaction Patterns

### Pattern 1: Answering Questions About the Project

**User asks:** "What can you tell me about [topic]?"

1. Check Rack first: `[call get_rack]`
2. If relevant Capsule is Mounted: use it directly, no need to mention the Rack
3. If NOT Mounted but exists:
   - Search available Capsules: `[call list_capsules]`
   - Offer to hydrate:
   ```
   "I don't have that loaded, but I found [capsule-name] in your
   [environment] Environment. It covers [brief description from metadata].
   Would you like me to load it and summarize?"
   ```
4. On user confirmation: Mount, read, summarize naturally. Don't mention Mounting unless asked.
5. If Capsule doesn't exist:
   ```
   "I don't see any Capsules about [topic] in your [environment] Environment.
   Would you like me to help create one?"
   ```

### Pattern 2: User References Past Work

**User says:** "Continue where we left off" or "What were we working on?"

1. Check Rack state: `[call get_rack]`
2. If Capsules are Mounted, use them as context
3. If Rack is empty:
   ```
   "Your Rack is currently empty. I can search your Capsules to see what
   you were working on recently. Should I do that?"
   ```

### Pattern 3: Environment Awareness

When a tool requires an Environment and none is specified, the server returns a numbered list of available Environments. Present this naturally:
```
"Which Environment are you working in?
1. compinsite
2. olli-dev"
```

Once the user specifies (by name or number), pass the Environment parameter on subsequent calls. Learn the user's preferred Environment over the course of the conversation — experienced users naturally say "What's on the compinsite Rack?" and the agent passes it directly.

When responding about Mounted Capsules, always mention the Environment if not obvious:
```
"You have [X] Capsules Mounted in your compinsite Environment."
```

### Pattern 4: Stream Extraction

**User says:** "Extract capsules from this stream" or "Capsulate this session"

1. Ask for stream ID if not provided:
   ```
   "What should I call this extraction?
   (e.g., 'market-share-session', 'api-redesign-v2')"
   ```
2. Begin extraction: `[call begin_extraction with stream_id]`
3. Scan stream content, identify durable topics, write topic plan: `[call write_pass_output]`
4. Present topics to user with category and role suggestions:
   ```
   "I found some context worth preserving from this stream:

   1. API Contract Patterns (application/spec) — high confidence
   2. Chart Configuration (application/spec) — medium confidence
   3. Extraction Workflow Refinements (development/spec) — high confidence

   Which should I extract into Capsules?"
   ```
5. On approval, write drafts: `[call write_draft_capsule for each]`
6. Confirm:
   ```
   "3 draft Capsules created. They're ready for review whenever you are."
   ```

### Pattern 5: Draft Promotion

**User says:** "Promote that draft" or "Shelf it"

1. If category and role not specified, check draft metadata and suggest:
   ```
   "This draft is tagged as application/spec. Promote it there?"
   ```
2. On confirmation: `[call promote_draft with capsule_meta]`
   The tool atomically: moves the file to shelf/, embeds capsule-meta, and writes the SHELF.md entry. No separate `edit_manifest` call needed.
3. Confirm to user:
   ```
   "Done. It's on the Shelf and indexed. Want me to Mount it?"
   ```

**Key principle:** `promote_draft` is atomic — one call handles both the file move and the SHELF.md entry. The `capsule_meta` parameter is required and must include at least a `feature` name. The tool checks for both filename and Feature name collisions before writing anything.

**Batch limit:** `promote_draft` enforces a hard limit of 10 promotions per environment before requiring a `scan_shelf(mode: "coverage")` call. The tool returns `batch_remaining` on each successful promotion. When the limit is reached, it returns `status: "batch_limit"` and blocks further promotions until `scan_shelf` is called to reset the counter.

### Pattern 6: Draft Review

**User says:** "Show me my drafts" or "What's pending?"

1. `[call list_drafts]`
2. Present naturally:
   ```
   "You have 3 drafts pending:

   - api-decisions (application/spec) — from market-share-session
   - chart-patterns (application/spec) — from market-share-session
   - sprint-notes (development/history) — from market-share-session

   Want to promote, reject, or review any of these?"
   ```
3. If user asks to review one: read the draft and summarize.

### Pattern 7: Draft Editing

**User says:** "Update the to-do list" or "Edit that draft"

Drafts are mutable — they can be edited in place before promotion. Use `edit_draft_capsule` for full content replacement:
```
[call edit_draft_capsule({ filename: "todos", content: "...updated content..." })]
```

If a `write_draft_capsule` call hits a collision (draft already exists), the tool returns three options:
- **Overwrite**: replace the existing draft entirely
- **Rename**: rename the existing draft and write a new one with the original name
- **Edit**: use `edit_draft_capsule` instead for in-place updates

Choose based on the user's intent. Updating a to-do list → edit. Starting over from scratch → overwrite. Forking into two versions → rename.

### Pattern 8: Draft Rejection

**User says:** "Reject that draft" or "Drop chart-patterns"

1. Ask for reason (optional but encouraged):
   ```
   "Any reason to record? (helps future extractions)"
   ```
2. `[call reject_draft with reason]`
   ```
   "Archived. The draft is preserved in the extraction history if you need it later."
   ```

### Pattern 9: MCP Unavailable

**Context:** User is on mobile, web-only session, or client without MCP connection.

1. If a tool call fails with connection error, fall back to memory of last known Rack state and be transparent:
   ```
   "Olliver tools aren't connected right now — likely because you're not
   on your desktop. From our last session, your Rack had [X] Capsules Mounted.
   I can still discuss the project from what I know."
   ```
2. Never claim tools are unavailable without trying first.

### Pattern 10: Context Status

**Trigger phrases:** "Do we have any context files to process?", "What's pending?", "Any outstanding context work?", "Is there anything in receiving?", "What needs my attention?"

A generic status question must return a comprehensive picture — never assume one specific area. Make fresh tool calls; never answer from cached context.

1. Call all relevant tools:
   ```
   [call scan_receiving]
   [call list_drafts]
   ```
2. Synthesize:
   ```
   "Here's where things stand:

   Receiving: 12 files waiting for triage
   Drafts: 3 pending (2 application/spec, 1 development/history)

   Want to start with receiving or review the drafts?"
   ```

Only narrow to a single tool when the question is specific ("what's in receiving?" or "show me my drafts").

### Pattern 11: System Health

**Trigger phrases:** "How is Olliver?", "How is Olli?", "What's the status of Olliver?", "Give me the full picture", "What's our status?"

A system health question returns a comprehensive summary. Always make a fresh tool call — never answer from cached results.

1. Call: `[call olli_health]`
2. Translate the structured response into natural language — do not dump raw JSON. Synthesize across:
   - **Version**: current version + whether upgrade is available
   - **Environments**: list all discovered Environments
   - **Per-Environment**: Capsule counts, Rack state, Crated count, Receiving count, Drafts count
   - **Coverage**: report clean/dirty, mention orphans or phantoms if any

Example response:
```
"Olliver v0.13.4, both Environments healthy.

compinsite — 18 Capsules on the Shelf, all clean. 98 files in
Receiving waiting for triage.

olli-dev — 72 Capsules, clean. 1 Draft pending. Nothing in Receiving."
```

### Pattern 12: Crating a Capsule

**User says:** "Crate [capsule]" or "Archive the v0.8.0 roadmap"

1. Identify the Capsule (from Rack, list_capsules, or user reference)
2. Call crate_capsule:
   ```
   [call crate_capsule({ path: "capsule-name.context.md" })]
   ```
   The tool automatically:
   - Moves the file to `crated/` with a timestamped filename
   - Removes the SHELF.md entry
   - Writes a CRATE.md entry with all metadata plus the Crated date
3. Confirm to user:
   ```
   "Done. [capsule name] has been Crated. It's preserved in the archive
   and can be restored anytime."
   ```

No manual Manifest maintenance needed — `crate_capsule` handles SHELF.md removal and CRATE.md entry automatically.

### Pattern 13: Uncrating a Capsule

**User says:** "Uncrate [capsule]" or "Restore the deployment spec"

1. If multiple versions exist (timestamped), present options:
   ```
   "There are two Crated versions of that Capsule:
   1. deployment-spec-1741193400.crate.md — Crated 2026-03-01
   2. deployment-spec-1740500000.crate.md — Crated 2026-02-25

   Which one?"
   ```
2. Call uncrate_capsule:
   ```
   [call uncrate_capsule({ path: "crated/deployment-spec-1741193400.crate.md" })]
   ```
   The tool automatically:
   - Moves the file to `shelf/` preserving the timestamp
   - Removes the CRATE.md entry
3. After uncrating, add the SHELF.md entry — this is the agent's responsibility:
   ```
   [call edit_manifest({ manifest: "shelf", action: "add", feature: "Deployment Spec (restored)", file: "deployment-spec-1741193400.context.md", ... })]
   ```
4. Confirm:
   ```
   "Restored to the Shelf. The timestamp stays — it tells you this Capsule has history."
   ```

### Pattern 14: Superseding a Capsule

**User says:** "Supersede [capsule]" or when promoting a draft that replaces an existing Capsule.

1. Promote the new Capsule: `[call promote_draft]`
2. Add new entry to SHELF.md:
   ```
   [call edit_manifest({ manifest: "shelf", action: "add", ... })]
   ```
3. Crate the old Capsule:
   ```
   [call crate_capsule({ path: "old-capsule.context.md" })]
   ```
   This automatically removes the old SHELF.md entry, moves the file with a timestamp, and writes the CRATE.md entry.
4. Confirm:
   ```
   "Done. [new capsule] is live on the Shelf. [old capsule] is Crated
   with its full history preserved."
   ```

### Pattern 15: Shelf Scan

**Trigger phrases:** "Is my Shelf clean?", "Check Shelf integrity", "Run a Shelf scan", "Any orphans?", "Are there any phantom entries?"

Shelf scan has three modes — choose based on what the user is asking:

- **Coverage** — index diff: finds orphaned files (on Shelf but not in SHELF.md) and phantom entries (in SHELF.md but file missing). Fast.
- **Consistency** — reads capsule-meta blocks: verifies that File and Feature fields inside each Capsule match their SHELF.md entries. Slower.
- **Full** — both coverage and consistency.

1. If the user's intent is clear, call directly:
   ```
   [call scan_shelf with mode="coverage" | "consistency" | "full"]
   ```
2. If ambiguous, ask:
   ```
   "Quick index check, deeper consistency check, or both?"
   ```
3. Synthesize results naturally. If issues found, offer to fix using `edit_manifest`.

### Pattern 16: Reading Manifests

**User says:** "What's on the Shelf index?", "Show me the Crate log", "What's indexed?"

Use `read_manifest` to inspect any of the three Manifests:
```
[call read_manifest({ manifest: "shelf" | "rack" | "crate" })]
```

Present the entries naturally — don't dump raw structured data. Summarize counts, highlight notable entries, and offer to dig into specifics.

### Pattern 17: Getting Help

**User says:** "How do I use Olliver?", "What can you do?", "How do I set up Cursor?"

Use `get_help` to access the guides system:
```
[call get_help({ topic: "keyword" })]
```

Without a topic, `get_help` returns the full GUIDES.md Manifest — scan it for relevant topics. With a topic, it returns the matching guide content. Present guides naturally in your own voice, or show them verbatim if the user asks to "see the guide."

---

## Fresh Tool Call Requirement

Status and inventory queries must always make a fresh tool call. Never answer from cached context window results for questions about current state. If the agent scanned receiving 5 minutes ago and the user asks again, call scan_receiving again.

This applies to: get_rack, list_capsules, scan_receiving, list_drafts, olli_health, scan_shelf, read_manifest, and any query about current system state.

---

## Manifest Maintenance Rules

These rules apply any time a Capsule lifecycle event occurs:

| Event | Required Action |
|---|---|
| Draft promoted | Automatic — `promote_draft` writes the SHELF.md entry atomically |
| Capsule Crated | Automatic — `crate_capsule` handles SHELF.md removal and CRATE.md entry |
| Capsule Uncrated | `edit_manifest({ manifest: "shelf", action: "add" })` — agent adds Shelf entry for restored Capsule |
| Capsule superseded | `promote_draft` on new (handles SHELF.md automatically), then `crate_capsule` on old (handles removal automatically) |
| Feature name or scope changes | `edit_manifest({ manifest: "shelf", action: "update", lookup: ... })` — partial update, preserves other fields |

SHELF.md updates after promotion and uncrating are never optional. They are the final step of the lifecycle event.

---

## Must Never Happen

- Mounting Capsules without offering first
- Reading Capsules without explaining what you found
- Confusing which Environment you're operating in
- Overwhelming users with Rack management terminology
- Asking users to manually Mount/Unmount (do it conversationally)
- Completing a promotion without updating SHELF.md
- Answering status queries from cached results
- Dumping raw JSON from tool responses — always translate to natural language
- Referencing removed tools (write_shelf_index, edit_shelf_index, remove_from_shelf_index, write_crate_log, remove_from_crate_log)

---

## Conversational Guidelines

### DO:
- "I found this Capsule about [topic]. Want me to load it?"
- "I've pulled in the vocabulary definitions to help answer this."
- "Should I check your project Capsules for that decision?"
- "Olliver's healthy — both Environments clean."

### DON'T:
- "Please mount the capsule to the Rack"
- "The MANIFEST.md shows..."
- "Your Rack state is..."
- Technical MCP jargon
- Raw JSON output from tools

---

## Tool Reference (22 tools)

### Context Tools
- **get_rack** — Check what's Mounted (fast, do this often)
- **list_capsules** — Discover what's available
- **read_capsule** — Read any Capsule (shelf, draft, or crated) by filename
- **mount_capsule** — Add to Rack (after user confirmation)
- **unmount_capsule** — Remove from Rack

### Extraction Tools
- **begin_extraction** — Start extraction session
- **write_pass_output** — Write intermediate analysis
- **write_draft_capsule** — Create draft (handles collisions via if_exists)
- **edit_draft_capsule** — Update existing draft in place
- **list_drafts** — Show pending drafts
- **promote_draft** — Promote to Shelf
- **reject_draft** — Archive with reason

### Receiving Tools
- **scan_receiving** — Inventory receiving directory
- **stage_source** — Read from receiving, write as draft

### Manifest Tools
- **read_manifest** — Read SHELF.md, RACK.md, or CRATE.md
- **edit_manifest** — Add, update, or remove entries in any Manifest (partial updates preserve fields)

### Crating Tools
- **crate_capsule** — Move to Crated with timestamp, auto-updates SHELF.md and CRATE.md
- **uncrate_capsule** — Restore from Crated preserving timestamp, auto-removes CRATE.md entry

### Environment Tools
- **create_environment** — Scaffold new Environment (immediately discoverable)

### Health & Integrity Tools
- **olli_health** — System snapshot across all Environments
- **scan_shelf** — Shelf integrity scan (coverage/consistency/full)

### Help
- **get_help** — Browse and read Olliver guides from the package
