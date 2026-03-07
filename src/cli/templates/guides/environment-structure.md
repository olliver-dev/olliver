# Environment Structure

After `olli install`, your Environment looks like this:

```
.olli/                          Container
└── .my-project/                Environment
    ├── SHELF.md                Capsule index (Manifest)
    ├── RACK.md                 Rack state (Mounted Capsules)
    ├── shelf/                  Active Capsules
    ├── drafts/                 Pending draft Capsules
    ├── extractions/            Extraction stream working directories
    ├── receiving/              Incoming files for triage
    └── crated/
        └── CRATE.md            Archive index (Manifest)
```

## Container

The `.olli/` directory is the top-level Container. It holds one or more Environments as dot-prefixed subdirectories. The MCP server discovers all Environments in the Container automatically — no per-Environment configuration needed.

## Flat Architecture

All Capsules live directly in `shelf/` as flat filenames — no subdirectories. The filename is the identity: `api-architecture.context.md`, `product-definition.context.md`.

## Manifests

Three Manifest files track state:
- **SHELF.md** — indexes every Capsule on the Shelf with Feature name, filename, Categories, Roles, Scope, dependencies, and source stream
- **RACK.md** — lists currently Mounted Capsules (one path per line)
- **CRATE.md** — indexes archived Capsules with the same metadata plus a Crated date

Manifests are managed through the `read_manifest` and `edit_manifest` MCP tools. They can also be read and edited as plain text.

## Multiple Environments

A single Container can hold multiple Environments for different projects or concerns:

```
.olli/
├── .compinsite/        Production app context
├── .olli-dev/          Olliver development context
└── .research/          Research notes
```

All Environments are served by a single MCP server registration. The `environment` parameter on each tool call specifies which Environment to target. If only one Environment exists, it is selected automatically.
