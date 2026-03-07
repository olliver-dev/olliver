# What is Olliver?

Olliver is a context vessel that allows you to maintain project awareness across all MCP-compatible AI clients.

Your context lives on your filesystem as structured markdown files — not in any vendor's memory system. Any AI tool that speaks MCP can read, write, and manage your context through Olliver.

## What Olliver Is

- A portable, filesystem-first context vessel
- An MCP server that exposes your project knowledge to AI agents
- A system for capturing, organizing, and serving durable context

## What Olliver Is Not

- Not a database — it's plain markdown on disk
- Not vendor-locked — any MCP client works
- Not a memory system — you control what persists and what doesn't

## Core Concepts

### Container
The `.olli/` directory is a Container for Environments. It lives alongside your project and holds all Olliver data. The MCP server discovers Environments automatically from the Container.

### Environment
A context boundary inside the Container. Environments are dot-prefixed subdirectories (e.g., `.olli/.my-project/`). Each Environment has its own Shelf, Rack, Manifests, and Crate. Multiple Environments can coexist — one per project or concern.

### Shelf
The `shelf/` directory inside an Environment where all active Capsules live. Capsules on the Shelf are indexed in the SHELF.md Manifest.

### Capsule
A unit of durable context stored as a `.context.md` file. Capsules are plain markdown — human-readable and editable. They carry metadata (Categories, Roles) in the Manifest index.

### Rack
The set of Capsules currently loaded into context. Only Mounted Capsules participate in the conversation — existence on the Shelf is not participation. Rack state is persisted in RACK.md.

### Manifest
An index file that tracks entries. There are three Manifests:
- **SHELF.md** — indexes active Capsules on the Shelf
- **RACK.md** — tracks which Capsules are currently Mounted
- **CRATE.md** — indexes archived Capsules in the Crate

### Crate
The `crated/` directory where retired Capsules are preserved. Crated Capsules are removed from the Shelf but never deleted — they can be restored at any time.

### Categories
Metadata tags describing what domain a Capsule belongs to (e.g., "application", "development"). Categories are freeform and comma-separated in Manifest entries.

### Roles
Metadata tags describing what kind of artifact a Capsule is (e.g., "spec", "strategy", "discovery", "history", "research"). Roles are freeform and comma-separated in Manifest entries.
