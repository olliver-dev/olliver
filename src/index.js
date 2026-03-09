#!/usr/bin/env node

/**
 * Olliver MCP Server v0.13.5
 *
 * Exposes durable context capsules via Model Context Protocol.
 * Single container registration — all environments discovered automatically.
 *
 * Core invariants (must not break):
 * - Filesystem is source of truth
 * - Capsules are immutable once published
 * - Environment scope is upward-only (no lateral bleed)
 * - Existence !== participation (mounting is explicit)
 * - Rack state persists in RACK.md (per-environment)
 * - Flat shelf/ directory for capsules, metadata in manifests
 * - Tools are stateless (environment parameter is explicit)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import os from "os";
import { resolveShelf, checkUpgrade } from "./shared/resolve.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Default Configuration ─────────────────────────────────────────
// Used when no config.json exists in the environment directory

const DEFAULT_CONFIG = {
    version: "2.0",
};

function loadInstructions() {
    try {
        return readFileSync(path.join(__dirname, "instructions.md"), "utf-8");
    } catch {
        return undefined;
    }
}

class OlliverServer {
    constructor() {
        this.server = new Server(
            {
                name: "olliver",
                version: "0.13.5",
            },
            {
                capabilities: {
                    tools: {},
                },
                instructions: loadInstructions(),
            },
        );

        // Working directory (where .olli lives)
        // Supports OLLIVER_ROOT env var for NAS/shared filesystem scenarios
        this.workingDir = process.env.OLLIVER_ROOT || process.cwd();

        // Flag to avoid re-reading the dotfile on every resolveOlliContainer() call
        this._shelfResolved = false;

        // Batch promotion counter per environment — resets on scan_shelf
        this._promotionCounts = new Map();

        this.setupToolHandlers();

        // Error handling
        this.server.onerror = (error) => console.error("[MCP Error]", error);
        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    // ─── Environment Resolution ──────────────────────────────────────

    /**
     * Resolve the .olli/ container directory
     * Searches upward from working directory
     */
    async resolveOlliContainer() {
        // On first call, try the shared resolver (reads ~/.olliver dotfile)
        if (!this._shelfResolved) {
            this._shelfResolved = true;
            try {
                const shelfPath = await resolveShelf();
                if (shelfPath && existsSync(shelfPath)) {
                    // Shelf path points to .olli/ container
                    this.workingDir = path.dirname(shelfPath);
                }
            } catch {
                // Dotfile resolution failed — fall through to existing behavior
            }
        }

        let currentDir = this.workingDir;
        const root = path.parse(currentDir).root;

        while (currentDir !== root) {
            const olliPath = path.join(currentDir, ".olli");
            if (existsSync(olliPath)) {
                return olliPath;
            }
            currentDir = path.dirname(currentDir);
        }

        throw new Error(
            `.olli/ container not found in current path or ancestors`,
        );
    }

    /**
     * Discover all environments in the container.
     * Returns array of environment names (without dot prefix).
     * Includes "root" if the container itself has a SHELF.md.
     */
    async discoverEnvironments() {
        const container = await this.resolveOlliContainer();
        const envs = [];

        // Check if root (container itself) has SHELF.md
        if (existsSync(path.join(container, "SHELF.md"))) {
            envs.push("root");
        }

        // Scan for dot-prefixed subdirectories with SHELF.md
        try {
            const entries = await fs.readdir(container, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith(".")) {
                    if (existsSync(path.join(container, entry.name, "SHELF.md"))) {
                        envs.push(entry.name.slice(1)); // Strip leading dot
                    }
                }
            }
        } catch {
            // Container scan failed
        }

        return envs;
    }

    /**
     * Resolve environment parameter to a directory path.
     * If environment is provided, validate and return the path.
     * If omitted and only one environment exists, auto-select it.
     * If omitted and multiple environments exist, return a numbered prompt.
     */
    async resolveOrPrompt(environment) {
        const container = await this.resolveOlliContainer();
        const envs = await this.discoverEnvironments();

        if (envs.length === 0) {
            throw new Error(
                "No environments found in .olli/ container. Run create_environment first.",
            );
        }

        if (environment) {
            // Normalize: strip leading dot if provided
            let normalized = environment.replace(/^\./, "");

            // Handle numeric selection (user responded with "1", "2", etc.)
            const num = parseInt(normalized, 10);
            if (!isNaN(num) && num >= 1 && num <= envs.length) {
                normalized = envs[num - 1];
            }

            if (!envs.includes(normalized)) {
                throw new Error(
                    `Environment "${normalized}" not found. Available: ${envs.join(", ")}`,
                );
            }

            const envDir = normalized === "root"
                ? container
                : path.join(container, `.${normalized}`);

            return { resolved: normalized, envDir };
        }

        // Auto-select if only one environment
        if (envs.length === 1) {
            const envDir = envs[0] === "root"
                ? container
                : path.join(container, `.${envs[0]}`);
            return { resolved: envs[0], envDir };
        }

        // Multiple environments — return numbered list
        const list = envs.map((e, i) => `${i + 1}. ${e}`).join("\n");
        return {
            prompt: true,
            message: `Multiple environments available. Please specify:\n${list}`,
        };
    }

    // ─── Rack Management ─────────────────────────────────────────────

    /**
     * Load Rack state from RACK.md
     * Uses entry-based format (same structure as SHELF.md)
     */
    async loadRack(envDir) {
        const rackPath = path.join(envDir, "RACK.md");

        if (!existsSync(rackPath)) {
            return new Set();
        }

        try {
            const content = await fs.readFile(rackPath, "utf-8");
            const mounted = new Set();
            const entries = parseManifestEntries(content);

            for (const entry of entries) {
                if (entry.file) {
                    mounted.add(entry.file);
                }
            }

            return mounted;
        } catch (error) {
            console.error("[Rack] Failed to load RACK.md:", error.message);
            return new Set();
        }
    }

    /**
     * Save Rack state to RACK.md
     * Uses entry-based format matching SHELF.md structure
     */
    async saveRack(rack, envDir, envName) {
        const rackPath = path.join(envDir, "RACK.md");

        // Build entries from rack contents
        const today = new Date().toISOString().slice(0, 10);
        const entryTexts = [];

        // Try to read SHELF.md for metadata about mounted capsules
        const shelfMdPath = path.join(envDir, "SHELF.md");
        let shelfEntries = [];
        if (existsSync(shelfMdPath)) {
            try {
                const shelfContent = await fs.readFile(shelfMdPath, "utf-8");
                shelfEntries = parseManifestEntries(shelfContent);
            } catch {
                // Ignore — we'll use minimal entries
            }
        }

        for (const capsuleFile of rack) {
            // Look up metadata from SHELF.md
            const shelfEntry = shelfEntries.find((e) => e.file === capsuleFile);

            if (shelfEntry) {
                entryTexts.push(formatManifestEntry({
                    feature: shelfEntry.feature,
                    file: shelfEntry.file,
                    categories: shelfEntry.categories,
                    roles: shelfEntry.roles,
                    scope: shelfEntry.scope,
                    dependsOn: shelfEntry.dependsOn,
                    updated: shelfEntry.updated,
                    sourceStream: shelfEntry.sourceStream,
                }));
            } else {
                // Minimal entry for capsules without SHELF.md metadata
                const name = capsuleFile.replace(".context.md", "");
                entryTexts.push(formatManifestEntry({
                    feature: name,
                    file: capsuleFile,
                    categories: "uncategorized",
                    roles: "general",
                    scope: "Mounted capsule",
                    dependsOn: "None noted",
                    updated: today,
                    sourceStream: "manual",
                }));
            }
        }

        const content = `# Rack

Mounted capsules participating in current context.

## Environment
${envName}

## Mounted Capsules

${entryTexts.length > 0 ? entryTexts.join("\n\n") : "(empty)"}

## Metadata
- Last Modified: ${new Date().toISOString()}
- Capsule Count: ${rack.size}
`;

        await fs.writeFile(rackPath, content, "utf-8");
    }

    // ─── Capsule Discovery & Access ──────────────────────────────────

    /**
     * Discover all capsules in environment's shelf/ directory
     */
    async discoverCapsules(envDir, envName) {
        const capsules = [];
        const shelfDir = path.join(envDir, "shelf");

        if (!existsSync(shelfDir)) {
            return capsules;
        }

        // Load SHELF.md for metadata lookup
        const shelfMdPath = path.join(envDir, "SHELF.md");
        let shelfEntries = [];
        if (existsSync(shelfMdPath)) {
            try {
                const shelfContent = await fs.readFile(shelfMdPath, "utf-8");
                shelfEntries = parseManifestEntries(shelfContent);
            } catch {
                // Ignore
            }
        }

        try {
            const entries = await fs.readdir(shelfDir, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith(".context.md")) {
                    const fullPath = path.join(shelfDir, entry.name);
                    const content = await fs.readFile(fullPath, "utf-8");
                    const metadata = parseCapsuleMetadata(content);

                    // Look up categories/roles from SHELF.md
                    const shelfEntry = shelfEntries.find(
                        (e) => e.file === entry.name,
                    );

                    capsules.push({
                        path: entry.name,
                        fullPath,
                        name: entry.name.replace(".context.md", ""),
                        categories: shelfEntry?.categories || null,
                        roles: shelfEntry?.roles || metadata.role || null,
                        environment: envName,
                        purpose: metadata.purpose,
                    });
                }
            }
        } catch (error) {
            console.error(`[Scan] Could not read ${shelfDir}:`, error.message);
        }

        return capsules;
    }

    /**
     * Read a specific capsule by filename
     * Resolves directory from location param or auto-detects from extension:
     *   .context.md → shelf/
     *   .draft.md   → drafts/
     *   .crate.md   → crated/
     */
    async readCapsule(capsulePath, envDir, envName, location) {
        // Auto-detect location from extension if not specified
        if (!location) {
            if (capsulePath.endsWith(".draft.md")) {
                location = "drafts";
            } else if (capsulePath.endsWith(".crate.md")) {
                location = "crated";
            } else {
                location = "shelf";
            }
        }

        const baseDir = path.join(envDir, location);
        const fullPath = path.join(baseDir, capsulePath);

        // Security: prevent path traversal
        const resolvedPath = path.resolve(fullPath);
        if (!resolvedPath.startsWith(path.resolve(baseDir))) {
            throw new Error(`Invalid capsule path: ${capsulePath}`);
        }

        if (!existsSync(resolvedPath)) {
            throw new Error(`Capsule not found in ${location}/: ${capsulePath}`);
        }

        const content = await fs.readFile(resolvedPath, "utf-8");
        return {
            path: capsulePath,
            content,
            environment: envName,
            location,
            metadata: parseCapsuleMetadata(content),
        };
    }

    /**
     * Mount a capsule to the Rack
     */
    async mountCapsule(capsulePath, envDir, envName) {
        await this.readCapsule(capsulePath, envDir, envName);

        const rack = await this.loadRack(envDir);
        rack.add(capsulePath);
        await this.saveRack(rack, envDir, envName);

        return {
            mounted: capsulePath,
            rack: Array.from(rack),
            environment: envName,
        };
    }

    /**
     * Unmount a capsule from the Rack
     */
    async unmountCapsule(capsulePath, envDir, envName) {
        const rack = await this.loadRack(envDir);
        rack.delete(capsulePath);
        await this.saveRack(rack, envDir, envName);

        return {
            unmounted: capsulePath,
            rack: Array.from(rack),
            environment: envName,
        };
    }

    /**
     * Get current Rack state
     */
    async getRackState(envDir, envName) {
        const rack = await this.loadRack(envDir);
        const shelfDir = path.join(envDir, "shelf");
        const mounted = [];

        for (const capsulePath of rack) {
            const fullPath = path.join(shelfDir, capsulePath);
            const valid = existsSync(fullPath);
            mounted.push({ path: capsulePath, valid });
        }

        return {
            environment: envName,
            mounted,
            count: rack.size,
            stale: mounted.filter((m) => !m.valid).length,
        };
    }

    // ─── Extraction Methods ──────────────────────────────────────────

    /**
     * Validate stream ID is filesystem-safe
     */
    validateStreamId(streamId) {
        if (!streamId || typeof streamId !== "string") {
            throw new Error("stream_id is required");
        }
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(streamId)) {
            throw new Error(
                `Invalid stream_id "${streamId}". Must be lowercase, hyphen-separated, no spaces or punctuation (e.g., "env-resolution-go4")`,
            );
        }
        return streamId;
    }

    /**
     * Begin a new extraction session
     */
    async beginExtraction(streamId, envDir, envName) {
        this.validateStreamId(streamId);

        const extractionDir = path.join(envDir, "extractions", streamId);

        if (existsSync(extractionDir)) {
            throw new Error(
                `Extraction "${streamId}" already exists. Use a different stream_id or remove the existing extraction directory.`,
            );
        }

        await fs.mkdir(extractionDir, { recursive: true });

        const stateContent = `# Extraction State

## Stream ID
${streamId}

## Environment
${envName}

## Status
in-progress

## Started
${new Date().toISOString()}

## Passes Completed
(none)
`;

        await fs.writeFile(
            path.join(extractionDir, "extraction-state.md"),
            stateContent,
            "utf-8",
        );

        return {
            stream_id: streamId,
            environment: envName,
            extraction_dir: extractionDir,
            status: "created",
        };
    }

    /**
     * Write a pass output file to the extraction directory
     */
    async writePassOutput(streamId, filename, content, envDir) {
        this.validateStreamId(streamId);

        if (!filename || typeof filename !== "string") {
            throw new Error("filename is required");
        }
        if (!content || typeof content !== "string") {
            throw new Error("content is required");
        }

        const extractionDir = path.join(envDir, "extractions", streamId);

        if (!existsSync(extractionDir)) {
            throw new Error(
                `Extraction "${streamId}" not found. Call begin_extraction first.`,
            );
        }

        const safeName = path.basename(filename);
        const filePath = path.join(extractionDir, safeName);

        await fs.writeFile(filePath, content, "utf-8");
        await this.updateExtractionState(streamId, safeName, envDir);

        return {
            stream_id: streamId,
            file: safeName,
            path: filePath,
            status: "written",
        };
    }

    /**
     * Update extraction state file with completed pass info
     */
    async updateExtractionState(streamId, completedFile, envDir) {
        const extractionDir = path.join(envDir, "extractions", streamId);
        const statePath = path.join(extractionDir, "extraction-state.md");

        if (existsSync(statePath)) {
            let stateContent = await fs.readFile(statePath, "utf-8");

            const passesMatch = stateContent.match(
                /## Passes Completed\n([\s\S]*?)(?=\n##|$)/,
            );
            if (passesMatch) {
                const currentPasses = passesMatch[1].trim();
                const newPasses =
                    currentPasses === "(none)"
                        ? `- ${completedFile} (${new Date().toISOString()})`
                        : `${currentPasses}\n- ${completedFile} (${new Date().toISOString()})`;

                stateContent = stateContent.replace(
                    /## Passes Completed\n[\s\S]*?(?=\n##|$)/,
                    `## Passes Completed\n${newPasses}\n`,
                );

                await fs.writeFile(statePath, stateContent, "utf-8");
            }
        }
    }

    /**
     * Write a draft capsule to the drafts/ directory
     * Uses .draft.md extension — invisible to list_capsules until promoted
     */
    async writeDraftCapsule(streamId, filename, role, category, content, ifExists, renameTo, envDir, envName) {
        if (streamId) {
            this.validateStreamId(streamId);
        }

        if (!filename || typeof filename !== "string") {
            throw new Error("filename is required");
        }
        if (!role || typeof role !== "string") {
            throw new Error("role is required");
        }
        if (!category || typeof category !== "string") {
            throw new Error("category is required");
        }
        if (!content || typeof content !== "string") {
            throw new Error("content is required");
        }

        const draftsDir = path.join(envDir, "drafts");
        await fs.mkdir(draftsDir, { recursive: true });

        // Normalize filename
        const baseName = filename
            .replace(/\.context\.md$/, "")
            .replace(/\.draft\.md$/, "")
            .replace(/\.md$/, "");
        const draftFilename = `${baseName}.draft.md`;
        const draftPath = path.join(draftsDir, draftFilename);

        // Collision handling
        let renamedExisting = null;
        if (existsSync(draftPath)) {
            if (!ifExists) {
                return {
                    status: "error",
                    error: `Draft already exists: ${draftFilename}. Options:\n- To replace it: set if_exists to "overwrite"\n- To keep it and rename: set if_exists to "rename" with rename_to\n- To update it in place: use edit_draft_capsule instead`,
                };
            }

            if (ifExists === "overwrite") {
                // Fall through — will overwrite below
            } else if (ifExists === "rename") {
                if (!renameTo || typeof renameTo !== "string") {
                    return {
                        status: "error",
                        error: 'rename_to is required when if_exists is "rename".',
                    };
                }
                const renameBase = renameTo
                    .replace(/\.context\.md$/, "")
                    .replace(/\.draft\.md$/, "")
                    .replace(/\.md$/, "");
                const renameFilename = `${renameBase}.draft.md`;
                const renamePath = path.join(draftsDir, renameFilename);

                if (existsSync(renamePath)) {
                    return {
                        status: "error",
                        error: `Cannot rename: ${renameFilename} already exists. Choose a different rename_to value.`,
                    };
                }

                await fs.rename(draftPath, renamePath);
                renamedExisting = renameFilename;
            } else {
                return {
                    status: "error",
                    error: `Invalid if_exists value: "${ifExists}". Use "overwrite" or "rename".`,
                };
            }
        }

        const draftContent = `<!-- DRAFT METADATA
stream_id: ${streamId || "none"}
categories: ${category}
roles: ${role}
created: ${new Date().toISOString()}
environment: ${envName}
status: pending
-->

${content}`;

        await fs.writeFile(draftPath, draftContent, "utf-8");

        const result = {
            stream_id: streamId || null,
            draft_file: draftFilename,
            draft_path: draftPath,
            roles: role,
            categories: category,
            environment: envName,
            status: renamedExisting ? "draft_created" : (ifExists === "overwrite" ? "draft_overwritten" : "draft_created"),
        };

        if (renamedExisting) {
            result.renamed_existing = renamedExisting;
        }

        return result;
    }

    async editDraftCapsule(filename, content, envDir, envName) {
        if (!filename || typeof filename !== "string") {
            throw new Error("filename is required");
        }
        if (!content || typeof content !== "string") {
            throw new Error("content is required");
        }

        const draftsDir = path.join(envDir, "drafts");
        const baseName = filename
            .replace(/\.context\.md$/, "")
            .replace(/\.draft\.md$/, "")
            .replace(/\.md$/, "");
        const draftFilename = `${baseName}.draft.md`;
        const draftPath = path.join(draftsDir, draftFilename);

        if (!existsSync(draftPath)) {
            return {
                status: "error",
                error: `Draft not found: ${draftFilename}. Use write_draft_capsule to create a new draft.`,
            };
        }

        await fs.writeFile(draftPath, content, "utf-8");

        return {
            status: "draft_updated",
            draft_file: draftFilename,
            draft_path: draftPath,
            environment: envName,
        };
    }

    /**
     * List all draft capsules in the specified environment
     * Scans single drafts/ directory
     */
    async listDrafts(categoryFilter, envDir) {
        const drafts = [];
        const draftsDir = path.join(envDir, "drafts");

        if (!existsSync(draftsDir)) return drafts;

        try {
            const entries = await fs.readdir(draftsDir, {
                withFileTypes: true,
            });

            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith(".draft.md")) {
                    const fullPath = path.join(draftsDir, entry.name);
                    const content = await fs.readFile(fullPath, "utf-8");
                    const metadata = this.parseDraftMetadata(content);

                    // Apply category filter if provided
                    if (categoryFilter && metadata.categories !== categoryFilter) {
                        continue;
                    }

                    drafts.push({
                        file: entry.name,
                        path: fullPath,
                        name: entry.name.replace(".draft.md", ""),
                        ...metadata,
                    });
                }
            }
        } catch (error) {
            console.error(
                `[Drafts] Could not read ${draftsDir}:`,
                error.message,
            );
        }

        return drafts;
    }

    /**
     * Parse draft metadata from the HTML comment header
     */
    parseDraftMetadata(content) {
        const metadata = {
            stream_id: null,
            categories: null,
            roles: null,
            created: null,
            environment: null,
            status: null,
        };

        const metaMatch = content.match(/<!-- DRAFT METADATA\n([\s\S]*?)-->/);
        if (metaMatch) {
            const lines = metaMatch[1].split("\n");
            for (const line of lines) {
                const kvMatch = line.match(/^(\w+):\s*(.+)$/);
                if (kvMatch) {
                    const key = kvMatch[1].trim();
                    const value = kvMatch[2].trim();
                    if (key in metadata) {
                        metadata[key] = value;
                    }
                }
            }
        }

        const capsuleMetadata = parseCapsuleMetadata(content);
        metadata.capsule_role = capsuleMetadata.role;
        metadata.capsule_purpose = capsuleMetadata.purpose;

        return metadata;
    }

    /**
     * Promote a draft capsule to a real capsule
     * Renames .draft.md → .context.md, moves to shelf/
     */
    async promoteDraft(draftFilename, category, targetRole, capsuleMetaArg, envDir, envName) {
        if (!draftFilename || typeof draftFilename !== "string") {
            throw new Error("draft_filename is required");
        }
        if (!category || typeof category !== "string") {
            throw new Error(
                'category is required — used as metadata tag (e.g., "application", "development")',
            );
        }
        if (!targetRole || typeof targetRole !== "string") {
            throw new Error(
                'target_role is required — used as metadata tag (e.g., "spec", "strategy", "history")',
            );
        }
        if (!capsuleMetaArg || !capsuleMetaArg.feature) {
            throw new Error(
                "capsule_meta with at least a feature name is required for promotion. This metadata is used to write the SHELF.md entry atomically.",
            );
        }

        // Batch limit: max 10 promotions before scan_shelf is required
        const count = this._promotionCounts.get(envName) || 0;
        if (count >= 10) {
            return {
                status: "batch_limit",
                promoted_count: count,
                message: `Batch limit reached: ${count} capsules promoted in ${envName} without a shelf scan. Run scan_shelf(mode: "coverage") and reconcile any orphans before continuing.`,
            };
        }

        // Derive target filename
        const capsuleFilename = draftFilename.replace(".draft.md", ".context.md");
        const today = new Date().toISOString().slice(0, 10);

        // Phase 1: Pre-flight collision checks (before any writes)

        // Check SHELF.md for Feature name collision
        const manifestPath = this.resolveManifestPath("shelf", envDir);
        if (existsSync(manifestPath)) {
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const entries = parseManifestEntries(manifestContent);
            const existing = entries.find((e) => e.feature === capsuleMetaArg.feature);
            if (existing) {
                return {
                    status: "collision",
                    collision_type: "manifest",
                    existing_entry: {
                        feature: existing.feature,
                        file: existing.file,
                    },
                    message: `SHELF.md already has an entry with Feature "${capsuleMetaArg.feature}". Supersede the existing capsule or use a different feature name.`,
                };
            }
        }

        // Check shelf/ for filename collision
        const targetDir = path.join(envDir, "shelf");
        const targetPath = path.join(targetDir, capsuleFilename);
        await fs.mkdir(targetDir, { recursive: true });

        if (existsSync(targetPath)) {
            return {
                status: "collision",
                collision_type: "file",
                existing_file: capsuleFilename,
                message: `Capsule already exists at shelf/${capsuleFilename}. Supersede it instead of overwriting.`,
            };
        }

        // Check draft exists
        const draftsDir = path.join(envDir, "drafts");
        const draftPath = path.join(draftsDir, draftFilename);

        if (!existsSync(draftPath)) {
            throw new Error(`Draft not found: ${draftFilename}`);
        }

        // Phase 2: Execute promotion (file move + manifest write)

        // Read and prepare draft content
        let content = await fs.readFile(draftPath, "utf-8");
        content = content.replace(/<!-- DRAFT METADATA\n[\s\S]*?-->\n\n/, "");

        // Embed capsule-meta block
        const metaBlock = [
            "<!-- capsule-meta",
            `- Feature: ${capsuleMetaArg.feature}`,
            `- File: ${capsuleFilename}`,
            `- Categories: ${category}`,
            `- Roles: ${targetRole}`,
            `- Scope: ${capsuleMetaArg.scope || ""}`,
            `- Depends on: ${capsuleMetaArg.depends_on || "None noted"}`,
            `- Updated: ${today}`,
            `- Source Stream: ${capsuleMetaArg.source_stream || "manual"}`,
            "-->",
        ].join("\n");

        const headingMatch = content.match(/^#[^\n]*\n/m);
        if (headingMatch) {
            const insertAt = headingMatch.index + headingMatch[0].length;
            const restOfContent = content.slice(insertAt).trimStart();
            content =
                content.slice(0, insertAt) +
                "\n" +
                metaBlock +
                "\n\n" +
                restOfContent;
        }

        // Write capsule to shelf
        await fs.writeFile(targetPath, content, "utf-8");

        // Write SHELF.md entry atomically
        try {
            await this.editManifest({
                manifest: "shelf",
                action: "add",
                feature: capsuleMetaArg.feature,
                file: capsuleFilename,
                categories: category,
                roles: targetRole,
                scope: capsuleMetaArg.scope || "",
                depends_on: capsuleMetaArg.depends_on || "None noted",
                updated: today,
                source_stream: capsuleMetaArg.source_stream || "manual",
            }, envDir, envName);
        } catch (manifestError) {
            // Rollback: remove the file we just wrote
            try {
                await fs.unlink(targetPath);
            } catch { /* best effort */ }
            throw new Error(
                `Promotion rolled back — SHELF.md write failed: ${manifestError.message}`,
            );
        }

        // Remove the draft only after both writes succeed
        await fs.unlink(draftPath);

        // Increment batch promotion counter
        this._promotionCounts.set(envName, count + 1);

        return {
            promoted: capsuleFilename,
            from: draftPath,
            to: targetPath,
            categories: category,
            roles: targetRole,
            environment: envName,
            status: "promoted",
            shelf_indexed: true,
            batch_remaining: 10 - (count + 1),
        };
    }

    /**
     * Reject a draft capsule
     * Moves to extraction's rejected directory with reason metadata
     */
    async rejectDraft(draftFilename, reason, envDir, envName) {
        if (!draftFilename || typeof draftFilename !== "string") {
            throw new Error("draft_filename is required");
        }

        // Search for draft in drafts/ directory
        const draftsDir = path.join(envDir, "drafts");
        const draftPath = path.join(draftsDir, draftFilename);

        if (!existsSync(draftPath)) {
            throw new Error(`Draft not found: ${draftFilename}`);
        }

        const content = await fs.readFile(draftPath, "utf-8");
        const metadata = this.parseDraftMetadata(content);

        // Determine rejection destination
        let rejectedDir;
        if (metadata.stream_id && metadata.stream_id !== "none") {
            const extractionDir = path.join(
                envDir, "extractions", metadata.stream_id,
            );
            rejectedDir = path.join(extractionDir, "rejected");
        } else {
            rejectedDir = path.join(envDir, "rejected");
        }

        await fs.mkdir(rejectedDir, { recursive: true });

        const rejectedPath = path.join(rejectedDir, draftFilename);
        await fs.rename(draftPath, rejectedPath);

        const rejectionMeta = `<!-- REJECTION
reason: ${reason || "No reason provided"}
rejected_at: ${new Date().toISOString()}
original_path: ${draftPath}
-->
`;

        const rejectedContent =
            rejectionMeta + (await fs.readFile(rejectedPath, "utf-8"));
        await fs.writeFile(rejectedPath, rejectedContent, "utf-8");

        return {
            rejected: draftFilename,
            reason: reason || "No reason provided",
            archived_to: rejectedPath,
            environment: envName,
            status: "rejected",
        };
    }

    // ─── Receiving Methods ──────────────────────────────────────────

    /**
     * Known binary file extensions for receiving scanning
     */
    static BINARY_EXTENSIONS = new Set([
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".ico",
        ".svg",
        ".webp",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".7z",
        ".rar",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".bin",
        ".dat",
        ".woff",
        ".woff2",
        ".ttf",
        ".eot",
        ".otf",
        ".mp3",
        ".mp4",
        ".wav",
        ".avi",
        ".mov",
        ".mkv",
        ".flac",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
    ]);

    /**
     * Check if a filename has a known binary extension
     */
    isBinaryFile(filename) {
        const ext = path.extname(filename).toLowerCase();
        return OlliverServer.BINARY_EXTENSIONS.has(ext);
    }

    /**
     * Generate a preview of a text file (first 50 lines or 2000 chars, whichever is shorter)
     */
    generatePreview(content) {
        const lines = content.split("\n");
        const first50 = lines.slice(0, 50).join("\n");
        if (first50.length <= 2000) {
            return first50;
        }
        return content.slice(0, 2000);
    }

    /**
     * Recursively collect files from a directory, flattening subdirectories
     */
    async collectReceivingFiles(dir, relativeBase = "") {
        const files = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            // Skip dot-prefixed subdirectories (.received, etc.)
            if (entry.isDirectory() && entry.name.startsWith(".")) {
                continue;
            }

            const relativeName = relativeBase
                ? path.join(relativeBase, entry.name)
                : entry.name;
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const subFiles = await this.collectReceivingFiles(
                    fullPath,
                    relativeName,
                );
                files.push(...subFiles);
            } else if (entry.isFile()) {
                files.push({ relativeName, fullPath });
            }
        }

        return files;
    }

    /**
     * Scan the specified environment's receiving directory
     * Returns file inventory with previews for triage
     */
    async scanReceiving(envDir, envName) {
        const receivingPath = path.join(envDir, "receiving");
        let created = false;

        if (!existsSync(receivingPath)) {
            await fs.mkdir(receivingPath, { recursive: true });
            created = true;
        }

        const fileEntries = await this.collectReceivingFiles(receivingPath);
        const files = [];

        for (const { relativeName, fullPath } of fileEntries) {
            const stat = await fs.stat(fullPath);
            const isBinary = this.isBinaryFile(relativeName);

            const fileInfo = {
                filename: relativeName,
                size_bytes: stat.size,
                extension: path.extname(relativeName).toLowerCase(),
            };

            if (isBinary) {
                fileInfo.preview = null;
                fileInfo.binary = true;
            } else {
                try {
                    const content = await fs.readFile(fullPath, "utf-8");
                    fileInfo.preview = this.generatePreview(content);
                } catch {
                    fileInfo.preview = null;
                    fileInfo.binary = true;
                }
            }

            files.push(fileInfo);
        }

        const result = {
            status: "ok",
            environment: envName,
            receiving_path: receivingPath,
            file_count: files.length,
            files,
        };

        if (created) {
            result.created = true;
        }

        return result;
    }

    /**
     * Stage a file from receiving as a draft capsule
     * Wraps writeDraftCapsule with receiving file reading and validation
     */
    async stageSource(filename, category, role, streamId, envDir, envName) {
        if (!filename || typeof filename !== "string") {
            throw new Error("filename is required");
        }
        if (!category || typeof category !== "string") {
            throw new Error("category is required");
        }
        if (!role || typeof role !== "string") {
            throw new Error("role is required");
        }
        if (streamId) {
            this.validateStreamId(streamId);
        }

        const receivingPath = path.join(envDir, "receiving");
        const filePath = path.resolve(path.join(receivingPath, filename));

        // Security: prevent path traversal
        if (!filePath.startsWith(path.resolve(receivingPath))) {
            throw new Error("Invalid filename: path traversal not allowed");
        }

        if (!existsSync(filePath)) {
            throw new Error(`File not found in receiving: ${filename}`);
        }

        // Check binary
        if (this.isBinaryFile(filename)) {
            throw new Error("Binary files cannot be staged as capsules");
        }

        // Read and validate content
        const content = await fs.readFile(filePath, "utf-8");
        if (!content || content.trim().length === 0) {
            throw new Error("Empty files cannot be staged");
        }

        // Derive base name for draft
        const baseName = path
            .basename(filename)
            .replace(/\.context\.md$/, "")
            .replace(/\.md$/, "");

        // Write draft using existing logic
        const draftResult = await this.writeDraftCapsule(
            streamId || null,
            baseName,
            role,
            category,
            content,
            undefined,
            undefined,
            envDir,
            envName,
        );

        // Propagate collision guard errors
        if (draftResult.status === "error") {
            return draftResult;
        }

        // Move source file to .received/ dumpster
        let sourceMovedToReceived = true;
        try {
            const receivedDir = path.join(receivingPath, ".received");
            await fs.mkdir(receivedDir, { recursive: true });
            const receivedPath = path.join(receivedDir, path.basename(filename));
            await fs.rename(filePath, receivedPath);
        } catch {
            sourceMovedToReceived = false;
        }

        const result = {
            status: "ok",
            staged: baseName,
            draft_path: draftResult.draft_path,
            category,
            role,
            stream_id: streamId || null,
            source: `receiving/${filename}`,
        };

        if (!sourceMovedToReceived) {
            result.warning = `Source file not moved to .received/ — draft was created but original remains in receiving/${filename}`;
        }

        return result;
    }

    // ─── Environment Creation ─────────────────────────────────────────

    /**
     * Reserved environment names that cannot be used
     */
    static RESERVED_NAMES = new Set(["root", "global", "shared"]);

    /**
     * Create a new environment subdirectory inside .olli/
     */
    async createEnvironment(name) {
        // Validate name format
        if (!name || typeof name !== "string") {
            return {
                status: "error",
                message:
                    "Invalid environment name ''. Use lowercase letters, numbers, and hyphens. Must start with a letter.",
            };
        }

        if (!/^[a-z][a-z0-9-]*$/.test(name)) {
            return {
                status: "error",
                message: `Invalid environment name '${name}'. Use lowercase letters, numbers, and hyphens. Must start with a letter.`,
            };
        }

        // Check reserved names
        if (OlliverServer.RESERVED_NAMES.has(name)) {
            return {
                status: "error",
                message: `'${name}' is a reserved name. Choose a different name.`,
            };
        }

        // Resolve the .olli/ container
        let container;
        try {
            container = await this.resolveOlliContainer();
        } catch {
            try {
                const shelfPath = await resolveShelf();
                if (!shelfPath) {
                    return {
                        status: "error",
                        message: "No shelf configured. Run olli install first.",
                    };
                }
                container = shelfPath;
            } catch {
                return {
                    status: "error",
                    message: "No shelf configured. Run olli install first.",
                };
            }
        }

        const envDirName = `.${name}`;
        const envPath = path.join(container, envDirName);

        // Collision detection
        if (existsSync(envPath)) {
            return {
                status: "error",
                message: `Environment ${envDirName} already exists at ${envPath}`,
            };
        }

        // Create environment root
        await fs.mkdir(envPath, { recursive: true });

        // Write SHELF.md
        const shelfMdContent = `# Shelf Index

This file is an **AI-facing manifest and index**.
It is not a narrative.
It is not a changelog.
It is not intended for human consumption.

Its purpose is to:
- Enumerate capsules on this environment's Shelf
- Point to their corresponding Context Capsules
- Describe high-level dependencies between capsules
- New entries should be appended to the end of the document. **DO NOT** replace entries. Ensure there is double-space between each entry to maintain human readability.


## Context Capsules
`;
        await fs.writeFile(
            path.join(envPath, "SHELF.md"),
            shelfMdContent,
            "utf-8",
        );

        // Write RACK.md
        const rackContent = `# Rack

Mounted capsules participating in current context.

## Environment
${envDirName}

## Mounted Capsules

(empty)

## Metadata
- Last Modified: ${new Date().toISOString()}
- Capsule Count: 0
`;
        await fs.writeFile(
            path.join(envPath, "RACK.md"),
            rackContent,
            "utf-8",
        );

        // Create flat directories
        await fs.mkdir(path.join(envPath, "shelf"), { recursive: true });
        await fs.mkdir(path.join(envPath, "drafts"), { recursive: true });
        await fs.mkdir(path.join(envPath, "receiving"), { recursive: true });
        await fs.mkdir(path.join(envPath, "extractions"), { recursive: true });
        await fs.mkdir(path.join(envPath, "crated"), { recursive: true });

        // Scaffold CRATE.md
        const crateScaffold = [
            "# Crate Index",
            "",
            "This file is an **AI-facing manifest and index**.",
            "",
            "It is not a narrative.",
            "It is not a changelog.",
            "It is not intended for human consumption.",
            "",
            "Its purpose is to:",
            "- Enumerate capsules in this environment's Crate",
            "- Record the date each capsule was crated",
            "- Describe high-level dependencies between capsules",
            "- New entries should be appended to the end of the document. **DO NOT** replace entries. Ensure there is double-space between each entry to maintain human readability.",
            "",
            "## Crated Capsules",
            "",
        ].join("\n");
        await fs.writeFile(
            path.join(envPath, "CRATE.md"),
            crateScaffold,
            "utf-8",
        );

        // Verify environment is immediately discoverable
        const envs = await this.discoverEnvironments();

        return {
            status: "ok",
            environment: envDirName,
            path: envPath,
            created: true,
            directories: 5,
            discoverable: envs.includes(name),
            message: "This environment is immediately available — no configuration change needed.",
        };
    }

    // ─── Tool Handlers ───────────────────────────────────────────────

    setupToolHandlers() {
        // Environment parameter definition shared by all scoped tools
        const envParam = {
            type: "string",
            description:
                "Environment name (e.g., 'olli-dev', 'compinsite'). If omitted, you'll be prompted to select one.",
        };

        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "list_capsules",
                    description:
                        "Discover all capsules in an environment. Returns metadata including category, role, purpose, and path.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            environment: envParam,
                        },
                    },
                },
                {
                    name: "read_capsule",
                    description:
                        "Read any capsule — shelf, draft, or crated — by filename. Auto-detects location from extension (.context.md → shelf, .draft.md → drafts, .crate.md → crated), or specify location explicitly. Returns full content and metadata. Does not mount the capsule.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: {
                                type: "string",
                                description: `Capsule filename (e.g., "product-definition.context.md", "api-decisions.draft.md", "old-spec-1741193400.crate.md")`,
                            },
                            location: {
                                type: "string",
                                enum: ["shelf", "drafts", "crated"],
                                description:
                                    "Which directory to read from. Auto-detected from file extension if omitted.",
                            },
                            environment: envParam,
                        },
                        required: ["path"],
                    },
                },
                {
                    name: "mount_capsule",
                    description:
                        "Mount a capsule to the Rack (make it participate in current context). Persists to RACK.md.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: {
                                type: "string",
                                description:
                                    "Capsule filename within shelf/ directory",
                            },
                            environment: envParam,
                        },
                        required: ["path"],
                    },
                },
                {
                    name: "unmount_capsule",
                    description:
                        "Unmount a capsule from the Rack. Updates RACK.md. Does not delete the capsule.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: {
                                type: "string",
                                description:
                                    "Capsule filename within shelf/ directory",
                            },
                            environment: envParam,
                        },
                        required: ["path"],
                    },
                },
                {
                    name: "get_rack",
                    description:
                        "Get current Rack state (list of mounted capsules participating in context). Shows environment and scope.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            environment: envParam,
                        },
                    },
                },
                {
                    name: "begin_extraction",
                    description:
                        "Start a new extraction session. Creates a working directory for extraction artifacts. Stream ID must be a lowercase, hyphen-separated slug.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            stream_id: {
                                type: "string",
                                description:
                                    "Filesystem-safe slug identifying this stream (lowercase, hyphens, no spaces)",
                            },
                            environment: envParam,
                        },
                        required: ["stream_id"],
                    },
                },
                {
                    name: "write_pass_output",
                    description:
                        "Write a pass output file to the extraction working directory. Used for topic discovery plans and intermediate analysis.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            stream_id: {
                                type: "string",
                                description: "Stream ID from begin_extraction",
                            },
                            filename: {
                                type: "string",
                                description:
                                    'Output filename (e.g., "stream-id__TOPICS.md")',
                            },
                            content: {
                                type: "string",
                                description: "File content to write",
                            },
                            environment: envParam,
                        },
                        required: ["stream_id", "filename", "content"],
                    },
                },
                {
                    name: "write_draft_capsule",
                    description:
                        "Write a draft capsule (.draft.md) to the drafts/ directory. Drafts are invisible to list_capsules until promoted. Handles collisions via if_exists parameter.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            stream_id: {
                                type: "string",
                                description:
                                    "Stream ID this capsule was extracted from",
                            },
                            filename: {
                                type: "string",
                                description:
                                    'Capsule name (e.g., "api-decisions"). Extension is added automatically.',
                            },
                            role: {
                                type: "string",
                                description:
                                    'Capsule role (e.g., "spec", "strategy", "history", "research", "discovery")',
                            },
                            category: {
                                type: "string",
                                description:
                                    'Category metadata tag (e.g., "application", "development")',
                            },
                            content: {
                                type: "string",
                                description: "Full capsule content in markdown",
                            },
                            if_exists: {
                                type: "string",
                                enum: ["overwrite", "rename"],
                                description:
                                    'What to do if a draft with this filename already exists. "overwrite" replaces it. "rename" renames the existing draft (requires rename_to).',
                            },
                            rename_to: {
                                type: "string",
                                description:
                                    'New filename for the existing draft when if_exists is "rename". Without .draft.md extension.',
                            },
                            environment: envParam,
                        },
                        required: [
                            "stream_id",
                            "filename",
                            "role",
                            "category",
                            "content",
                        ],
                    },
                },
                {
                    name: "edit_draft_capsule",
                    description:
                        "Update an existing draft capsule in place with new content. The draft must already exist. This is a full content replacement.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filename: {
                                type: "string",
                                description:
                                    'Draft filename without .draft.md extension (e.g., "todos")',
                            },
                            content: {
                                type: "string",
                                description: "Full replacement content for the draft",
                            },
                            environment: envParam,
                        },
                        required: ["filename", "content"],
                    },
                },
                {
                    name: "list_drafts",
                    description:
                        "List all pending draft capsules (.draft.md) in the drafts/ directory, optionally filtered by category metadata.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            category: {
                                type: "string",
                                description:
                                    'Optional: filter by category metadata (e.g., "application", "development"). Omit to list all.',
                            },
                            environment: envParam,
                        },
                    },
                },
                {
                    name: "promote_draft",
                    description:
                        "Promote a draft capsule to a real capsule. Atomic operation: moves file from drafts/ to shelf/, embeds capsule-meta, and writes the SHELF.md entry in one call. No separate edit_manifest call needed. Enforces a batch limit of 10 promotions per environment — run scan_shelf to reset.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            draft_filename: {
                                type: "string",
                                description:
                                    'Draft filename (e.g., "api-decisions.draft.md")',
                            },
                            category: {
                                type: "string",
                                description:
                                    'Category metadata tag (e.g., "application", "development")',
                            },
                            target_role: {
                                type: "string",
                                description:
                                    'Role metadata tag (e.g., "spec", "strategy", "history")',
                            },
                            capsule_meta: {
                                type: "object",
                                description:
                                    "Required capsule identity metadata. Embedded in the capsule file and written to SHELF.md atomically.",
                                properties: {
                                    feature: {
                                        type: "string",
                                        description: "Feature name (must be unique in SHELF.md)",
                                    },
                                    scope: {
                                        type: "string",
                                        description: "Scope description",
                                    },
                                    depends_on: {
                                        type: "string",
                                        description: "Dependencies",
                                    },
                                    source_stream: {
                                        type: "string",
                                        description: "Source stream ID",
                                    },
                                },
                                required: ["feature"],
                            },
                            environment: envParam,
                        },
                        required: ["draft_filename", "category", "target_role", "capsule_meta"],
                    },
                },
                {
                    name: "reject_draft",
                    description:
                        "Reject a draft capsule. Archives to extraction rejected/ directory with reason metadata.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            draft_filename: {
                                type: "string",
                                description:
                                    'Draft filename to reject (e.g., "api-decisions.draft.md")',
                            },
                            reason: {
                                type: "string",
                                description: "Reason for rejection (optional)",
                            },
                            environment: envParam,
                        },
                        required: ["draft_filename"],
                    },
                },
                {
                    name: "scan_receiving",
                    description:
                        "Scan an environment's receiving directory. Returns file inventory with previews for triage.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            environment: envParam,
                        },
                    },
                },
                {
                    name: "stage_source",
                    description:
                        "Read a file from receiving and write it as a draft capsule. The agent is responsible for classification and content transformation.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            filename: {
                                type: "string",
                                description:
                                    "File in the receiving directory to process",
                            },
                            category: {
                                type: "string",
                                description:
                                    'Category metadata tag for the draft (e.g., "application", "development")',
                            },
                            role: {
                                type: "string",
                                description:
                                    'Role metadata tag for the draft (e.g., "spec", "strategy", "discovery", "history", "research")',
                            },
                            stream_id: {
                                type: "string",
                                description:
                                    "Optional extraction stream ID for lineage tracking (lowercase, hyphens, no spaces)",
                            },
                            environment: envParam,
                        },
                        required: ["filename", "category", "role"],
                    },
                },
                {
                    name: "create_environment",
                    description:
                        "Create a new environment subdirectory inside the .olli/ container. Scaffolds SHELF.md, RACK.md, CRATE.md, shelf/, drafts/, receiving/, extractions/, and crated/ directories. New environments are immediately available — no configuration change needed.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                description:
                                    "Project name (lowercase, alphanumeric, hyphens). Creates .olli/.<name>/ directory.",
                            },
                        },
                        required: ["name"],
                    },
                },
                {
                    name: "read_manifest",
                    description:
                        "Read and parse a manifest file (SHELF.md, RACK.md, or CRATE.md). Returns all entries as structured objects.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            manifest: {
                                type: "string",
                                description:
                                    'Which manifest to read: "shelf", "rack", or "crate"',
                            },
                            environment: envParam,
                        },
                        required: ["manifest"],
                    },
                },
                {
                    name: "edit_manifest",
                    description:
                        "Add, update, or remove entries in a manifest (SHELF.md, RACK.md, or CRATE.md). Update preserves fields not explicitly passed.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            manifest: {
                                type: "string",
                                description:
                                    'Which manifest: "shelf", "rack", or "crate"',
                            },
                            action: {
                                type: "string",
                                description:
                                    '"add", "update", or "remove"',
                            },
                            lookup: {
                                type: "string",
                                description:
                                    "Feature name or filename to match (required for update/remove)",
                            },
                            feature: {
                                type: "string",
                                description:
                                    "Human-readable Feature name (required for add)",
                            },
                            file: {
                                type: "string",
                                description:
                                    "Filename only, no paths (required for add)",
                            },
                            categories: {
                                type: "string",
                                description: "Comma-separated categories",
                            },
                            roles: {
                                type: "string",
                                description: "Comma-separated roles",
                            },
                            scope: {
                                type: "string",
                                description: "What this capsule covers",
                            },
                            depends_on: {
                                type: "string",
                                description:
                                    'Capsule names or "None noted"',
                            },
                            updated: {
                                type: "string",
                                description: "YYYY-MM-DD",
                            },
                            source_stream: {
                                type: "string",
                                description: "Stream identifier",
                            },
                            crated: {
                                type: "string",
                                description: "YYYY-MM-DD (for crate manifest)",
                            },
                            environment: envParam,
                        },
                        required: ["manifest", "action"],
                    },
                },
                {
                    name: "crate_capsule",
                    description:
                        "Move a capsule from shelf/ to crated/, changing extension to .crate.md.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: {
                                type: "string",
                                description:
                                    "Capsule filename in shelf/ (e.g., 'my-capsule.context.md')",
                            },
                            environment: envParam,
                        },
                        required: ["path"],
                    },
                },
                {
                    name: "uncrate_capsule",
                    description:
                        "Restore a crated capsule to its original Shelf path.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: {
                                type: "string",
                                description:
                                    "Relative path from environment root to the .crate.md file in crated/",
                            },
                            environment: envParam,
                        },
                        required: ["path"],
                    },
                },
                {
                    name: "olli_health",
                    description:
                        "System health snapshot across all environments: version, rack state, shelf counts, receiving/staging files, active extractions, and coverage scan.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                },
                {
                    name: "scan_shelf",
                    description:
                        "Shelf integrity scan with three modes: coverage (index diff), consistency (capsule-meta vs SHELF.md), or full (both).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            mode: {
                                type: "string",
                                description:
                                    'Scan mode: "coverage", "consistency", or "full"',
                            },
                            environment: envParam,
                        },
                        required: ["mode"],
                    },
                },
                {
                    name: "get_help",
                    description:
                        "Browse and read Olliver guides. Returns the guide manifest if no topic is specified, or the matching guide content if a topic is provided.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            topic: {
                                type: "string",
                                description:
                                    "Topic name or keyword to search for. If omitted, returns the full guides manifest.",
                            },
                        },
                    },
                },
            ],
        }));

        this.server.setRequestHandler(
            CallToolRequestSchema,
            async (request) => {
                try {
                    switch (request.params.name) {
                        case "list_capsules": {
                            const { environment } = request.params.arguments || {};
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const capsules = await this.discoverCapsules(env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(capsules, null, 2),
                                    },
                                ],
                            };
                        }

                        case "read_capsule": {
                            const { path: capsulePath, location, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const capsule = await this.readCapsule(capsulePath, env.envDir, env.resolved, location);
                            return {
                                content: [
                                    { type: "text", text: capsule.content },
                                ],
                            };
                        }

                        case "mount_capsule": {
                            const { path: capsulePath, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.mountCapsule(capsulePath, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "unmount_capsule": {
                            const { path: capsulePath, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result =
                                await this.unmountCapsule(capsulePath, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "get_rack": {
                            const { environment } = request.params.arguments || {};
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const rack = await this.getRackState(env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(rack, null, 2),
                                    },
                                ],
                            };
                        }

                        case "begin_extraction": {
                            const { stream_id, environment } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result =
                                await this.beginExtraction(stream_id, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "write_pass_output": {
                            const { stream_id, filename, content, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.writePassOutput(
                                stream_id,
                                filename,
                                content,
                                env.envDir,
                            );
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "write_draft_capsule": {
                            const {
                                stream_id,
                                filename,
                                role,
                                category,
                                content,
                                if_exists,
                                rename_to,
                                environment,
                            } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.writeDraftCapsule(
                                stream_id,
                                filename,
                                role,
                                category,
                                content,
                                if_exists,
                                rename_to,
                                env.envDir,
                                env.resolved,
                            );
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.status === "error"
                                    ? { isError: true }
                                    : {}),
                            };
                        }

                        case "edit_draft_capsule": {
                            const {
                                filename,
                                content,
                                environment,
                            } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.editDraftCapsule(
                                filename,
                                content,
                                env.envDir,
                                env.resolved,
                            );
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.status === "error"
                                    ? { isError: true }
                                    : {}),
                            };
                        }

                        case "list_drafts": {
                            const { category, environment } = request.params.arguments || {};
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const drafts = await this.listDrafts(category, env.envDir);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(drafts, null, 2),
                                    },
                                ],
                            };
                        }

                        case "promote_draft": {
                            const {
                                draft_filename,
                                category,
                                target_role,
                                capsule_meta,
                                environment,
                            } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.promoteDraft(
                                draft_filename,
                                category,
                                target_role,
                                capsule_meta,
                                env.envDir,
                                env.resolved,
                            );
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "reject_draft": {
                            const { draft_filename, reason, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.rejectDraft(
                                draft_filename,
                                reason,
                                env.envDir,
                                env.resolved,
                            );
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "scan_receiving": {
                            const { environment } = request.params.arguments || {};
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.scanReceiving(env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "stage_source": {
                            const { filename, category, role, stream_id, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.stageSource(
                                filename,
                                category,
                                role,
                                stream_id,
                                env.envDir,
                                env.resolved,
                            );
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "create_environment": {
                            const { name } = request.params.arguments;
                            const result = await this.createEnvironment(name);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.status === "error"
                                    ? { isError: true }
                                    : {}),
                            };
                        }

                        case "read_manifest": {
                            const { manifest, environment } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.readManifest(manifest, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "edit_manifest": {
                            const {
                                manifest, action, lookup,
                                feature, file, categories, roles, scope,
                                depends_on, updated, source_stream, crated,
                                environment,
                            } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.editManifest({
                                manifest, action, lookup,
                                feature, file, categories, roles, scope,
                                depends_on, updated, source_stream, crated,
                            }, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.status === "error" ||
                                result.status === "collision"
                                    ? { isError: true }
                                    : {}),
                            };
                        }

                        case "crate_capsule": {
                            const { path: capsulePath, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.crateCapsule({
                                path: capsulePath,
                            }, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.status === "error"
                                    ? { isError: true }
                                    : {}),
                            };
                        }

                        case "uncrate_capsule": {
                            const { path: cratedPath, environment } =
                                request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.uncrateCapsule({
                                path: cratedPath,
                            }, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.status === "error"
                                    ? { isError: true }
                                    : {}),
                            };
                        }

                        case "olli_health": {
                            const result = await this.olliHealth();
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        case "scan_shelf": {
                            const { mode, environment } = request.params.arguments;
                            const env = await this.resolveOrPrompt(environment);
                            if (env.prompt) {
                                return { content: [{ type: "text", text: env.message }] };
                            }
                            const result = await this.scanShelf({ mode }, env.envDir, env.resolved);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(result, null, 2),
                                    },
                                ],
                                ...(result.error ? { isError: true } : {}),
                            };
                        }

                        case "get_help": {
                            const { topic } = request.params.arguments || {};
                            const result = await this.getHelp(topic);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
                                    },
                                ],
                            };
                        }

                        default:
                            throw new Error(
                                `Unknown tool: ${request.params.name}`,
                            );
                    }
                } catch (error) {
                    return {
                        content: [
                            { type: "text", text: `Error: ${error.message}` },
                        ],
                        isError: true,
                    };
                }
            },
        );
    }

    // ─── Crating Tools ───────────────────────────────────────────────

    async crateCapsule({ path: capsulePath }, envDir, envName) {
        // Validate extension
        if (!capsulePath.endsWith(".context.md")) {
            return {
                status: "error",
                message: "Only .context.md files can be crated",
            };
        }

        // Resolve paths — capsulePath is filename only, lives in shelf/
        const shelfDir = path.join(envDir, "shelf");
        const sourcePath = path.join(shelfDir, capsulePath);

        // Validate file exists
        if (!existsSync(sourcePath)) {
            return {
                status: "error",
                message: `Capsule not found at shelf/${capsulePath}`,
            };
        }

        // Validate crated/ directory exists
        const cratedRootDir = path.join(envDir, "crated");
        if (!existsSync(cratedRootDir)) {
            return {
                status: "error",
                message:
                    "crated/ directory not found. Run olli install to scaffold.",
            };
        }

        // Check Rack and unmount if needed
        const rack = await this.loadRack(envDir);
        const wasMounted = rack.has(capsulePath);
        if (wasMounted) {
            await this.unmountCapsule(capsulePath, envDir, envName);
        }

        // Read SHELF.md entry before removing (for CRATE.md metadata)
        const shelfMdPath = path.join(envDir, "SHELF.md");
        let shelfEntry = null;
        if (existsSync(shelfMdPath)) {
            const shelfContent = await fs.readFile(shelfMdPath, "utf-8");
            const entries = parseManifestEntries(shelfContent);
            shelfEntry = entries.find(
                (e) => e.file === capsulePath
            );
        }

        // Read capsule content (unchanged)
        const content = await fs.readFile(sourcePath, "utf-8");

        // Construct timestamped crated filename
        const basename = path.basename(capsulePath, ".context.md");
        const timestamp = Math.floor(Date.now() / 1000);
        const cratedFilename = `${basename}-${timestamp}.crate.md`;
        const cratedPath = path.join(cratedRootDir, cratedFilename);

        // Ensure CRATE.md exists (create with scaffold if needed)
        const crateMdPath = this.resolveManifestPath("crate", envDir);
        if (!existsSync(crateMdPath)) {
            const scaffold = [
                "# Crate Index",
                "",
                "This manifest tracks capsules that have been removed from the active Shelf and preserved in the crate. Crated capsules are not deleted — they remain available for uncrating when needed.",
                "",
                "## Crated Capsules",
                "",
            ].join("\n");
            await fs.writeFile(crateMdPath, scaffold, "utf-8");
        }

        // Write CRATE.md entry
        const today = new Date().toISOString().slice(0, 10);
        const crateEntry = shelfEntry
            ? formatManifestEntry({
                feature: shelfEntry.feature,
                file: cratedFilename,
                categories: shelfEntry.categories || "uncategorized",
                roles: shelfEntry.roles || "general",
                scope: shelfEntry.scope || "",
                dependsOn: shelfEntry.dependsOn || "None noted",
                updated: shelfEntry.updated || null,
                sourceStream: shelfEntry.sourceStream || "manual",
                crated: today,
            })
            : formatManifestEntry({
                feature: basename.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                file: cratedFilename,
                categories: "uncategorized",
                roles: "general",
                scope: "",
                dependsOn: "None noted",
                sourceStream: "manual",
                crated: today,
            });

        const crateMdContent = await fs.readFile(crateMdPath, "utf-8");
        const newCrateContent = crateMdContent.trimEnd() + "\n\n" + crateEntry + "\n";
        await fs.writeFile(crateMdPath, newCrateContent, "utf-8");

        // Remove SHELF.md entry
        if (shelfEntry && existsSync(shelfMdPath)) {
            const shelfContent = await fs.readFile(shelfMdPath, "utf-8");
            let removeStart = shelfEntry.start;
            let removeEnd = shelfEntry.end;

            if (
                removeStart >= 2 &&
                shelfContent.slice(removeStart - 2, removeStart) === "\n\n"
            ) {
                removeStart -= 2;
            } else if (
                removeEnd + 2 <= shelfContent.length &&
                shelfContent.slice(removeEnd, removeEnd + 2) === "\n\n"
            ) {
                removeEnd += 2;
            }

            const newShelfContent =
                shelfContent.slice(0, removeStart) + shelfContent.slice(removeEnd);
            await fs.writeFile(shelfMdPath, newShelfContent, "utf-8");
        }

        // Write crated file (content unchanged)
        await fs.writeFile(cratedPath, content, "utf-8");

        // Delete original file
        await fs.unlink(sourcePath);

        // Return result
        return {
            status: "ok",
            original_path: capsulePath,
            crated_path: `crated/${cratedFilename}`,
            unmounted: wasMounted,
            shelf_entry_removed: !!shelfEntry,
            crate_entry_written: true,
            environment: envName,
        };
    }

    async uncrateCapsule({ path: cratedPath }, envDir, envName) {
        // Validate extension
        if (!cratedPath.endsWith(".crate.md")) {
            return {
                status: "error",
                message: "Only .crate.md files can be uncrated",
            };
        }

        // Resolve paths
        const fullCratedPath = path.join(envDir, cratedPath);

        // Validate file exists
        if (!existsSync(fullCratedPath)) {
            return {
                status: "error",
                message: `Crated capsule not found at ${cratedPath}`,
            };
        }

        // Read and parse capsule-meta block
        const content = await fs.readFile(fullCratedPath, "utf-8");
        const metaMatch = content.match(
            /<!-- capsule-meta\n([\s\S]*?)-->/
        );

        // Parse meta fields if present (optional for backward compat)
        let capsuleMeta = {};
        if (metaMatch) {
            const metaBlock = metaMatch[1];
            const parseField = (field) => {
                const m = metaBlock.match(new RegExp(`^(?:- |  )${field}: (.+)$`, "m"));
                return m ? m[1].trim() : "";
            };

            capsuleMeta = {
                feature: parseField("Feature"),
                file: parseField("File"),
                categories: parseField("Categories"),
                roles: parseField("Roles"),
                scope: parseField("Scope"),
                depends_on: parseField("Depends on"),
                updated: parseField("Updated"),
                source_stream: parseField("Source Stream"),
            };
        }

        // Derive restored filename from crate filename — swap .crate.md → .context.md
        const crateFilename = path.basename(cratedPath);
        const restoredFilename = crateFilename.replace(/\.crate\.md$/, ".context.md");

        const shelfDir = path.join(envDir, "shelf");
        const restoredFullPath = path.join(shelfDir, restoredFilename);

        // Check destination doesn't already exist
        if (existsSync(restoredFullPath)) {
            return {
                status: "error",
                message: `A capsule already exists at shelf/${restoredFilename}. Resolve the conflict before uncrating.`,
            };
        }

        // Ensure shelf/ directory exists
        await fs.mkdir(shelfDir, { recursive: true });

        // Move file to shelf/
        await fs.writeFile(restoredFullPath, content, "utf-8");
        await fs.unlink(fullCratedPath);

        // Remove entry from CRATE.md
        let crateEntryRemoved = false;
        const crateMdPath = this.resolveManifestPath("crate", envDir);
        if (existsSync(crateMdPath)) {
            const crateContent = await fs.readFile(crateMdPath, "utf-8");
            const crateEntries = parseManifestEntries(crateContent);
            const crateEntry = crateEntries.find(
                (e) => e.file === crateFilename
            );
            if (crateEntry) {
                let removeStart = crateEntry.start;
                let removeEnd = crateEntry.end;

                if (
                    removeStart >= 2 &&
                    crateContent.slice(removeStart - 2, removeStart) === "\n\n"
                ) {
                    removeStart -= 2;
                } else if (
                    removeEnd + 2 <= crateContent.length &&
                    crateContent.slice(removeEnd, removeEnd + 2) === "\n\n"
                ) {
                    removeEnd += 2;
                }

                const newCrateContent =
                    crateContent.slice(0, removeStart) + crateContent.slice(removeEnd);
                await fs.writeFile(crateMdPath, newCrateContent, "utf-8");
                crateEntryRemoved = true;
            }
        }

        // Return result
        return {
            status: "ok",
            crated_path: cratedPath,
            restored_path: restoredFilename,
            crate_entry_removed: crateEntryRemoved,
            capsule_meta: capsuleMeta,
            environment: envName,
        };
    }

    // ─── Help Tools ───────────────────────────────────────────────────

    async getHelp(topic) {
        const guidesDir = path.join(__dirname, "cli", "templates", "guides");
        const manifestPath = path.join(guidesDir, "GUIDES.md");

        if (!existsSync(manifestPath)) {
            return { error: "GUIDES.md not found in package. Reinstall Olliver." };
        }

        const manifest = await fs.readFile(manifestPath, "utf-8");

        // No topic — return full manifest
        if (!topic) {
            return manifest;
        }

        // Parse manifest entries (Topic/File/Scope lines)
        const entries = [];
        const topicRegex = /^- Topic:\s*(.+)$/gm;
        let match;
        while ((match = topicRegex.exec(manifest)) !== null) {
            const start = match.index;
            const entryText = manifest.slice(start).split(/\n\n/)[0];
            const fileMatch = entryText.match(/^\s+File:\s*(.+)$/m);
            const scopeMatch = entryText.match(/^\s+Scope:\s*(.+)$/m);
            entries.push({
                topic: match[1].trim(),
                file: fileMatch ? fileMatch[1].trim() : null,
                scope: scopeMatch ? scopeMatch[1].trim() : "",
            });
        }

        // Search for matches (case-insensitive)
        const needle = topic.toLowerCase();
        const matches = entries.filter(
            (e) =>
                e.topic.toLowerCase().includes(needle) ||
                e.scope.toLowerCase().includes(needle),
        );

        if (matches.length === 0) {
            return `No exact match for "${topic}". Here is the full guides manifest:\n\n${manifest}`;
        }

        if (matches.length === 1 && matches[0].file) {
            const guidePath = path.join(guidesDir, matches[0].file);
            if (existsSync(guidePath)) {
                const content = await fs.readFile(guidePath, "utf-8");
                return content;
            }
            return { error: `Guide file not found: ${matches[0].file}` };
        }

        // Multiple matches — return matching entries for agent to pick
        const matchList = matches.map(
            (m) => `- Topic: ${m.topic}\n  File: ${m.file}\n  Scope: ${m.scope}`,
        ).join("\n\n");
        return `Multiple matches for "${topic}":\n\n${matchList}\n\nSpecify a more precise topic to read the full guide.`;
    }

    // ─── Health & Integrity Tools ────────────────────────────────────

    async olliHealth() {
        try {
            const container = await this.resolveOlliContainer();
            const packageJson = JSON.parse(
                await fs.readFile(
                    path.join(__dirname, "..", "package.json"),
                    "utf-8"
                )
            );
            const currentVersion = packageJson.version;

            // Check upgrade
            let upgradeInfo = { upgrade_check: "unavailable" };
            try {
                const upgrade = await checkUpgrade(currentVersion);
                upgradeInfo = {
                    latest: upgrade.latest,
                    upgrade_available: upgrade.upgrade_available,
                    upgrade_check: "ok",
                };
            } catch {
                // Non-blocking failure
            }

            // Discover and report on all environments
            const envNames = await this.discoverEnvironments();
            const environments = {};

            for (const envName of envNames) {
                const envDir = envName === "root"
                    ? container
                    : path.join(container, `.${envName}`);

                const envReport = {};

                // Rack state
                try {
                    const rack = await this.loadRack(envDir);
                    const shelfDir = path.join(envDir, "shelf");
                    let stale = 0;
                    for (const capsulePath of rack) {
                        if (!existsSync(path.join(shelfDir, capsulePath))) {
                            stale++;
                        }
                    }
                    envReport.rack = {
                        mounted: rack.size,
                        stale,
                    };
                } catch {
                    envReport.rack = { mounted: 0, stale: 0 };
                }

                // Count shelf capsules
                try {
                    const shelfDir = path.join(envDir, "shelf");
                    const files = await fs.readdir(shelfDir);
                    envReport.shelf = {
                        total: files.filter((f) => f.endsWith(".context.md")).length,
                    };
                } catch {
                    envReport.shelf = { total: 0 };
                }

                // Count receiving files
                try {
                    const receivingDir = path.join(envDir, "receiving");
                    const files = await fs.readdir(receivingDir);
                    envReport.receiving = {
                        total: files.filter((f) => !f.startsWith(".")).length,
                    };
                } catch {
                    envReport.receiving = { total: 0 };
                }

                // Count drafts
                try {
                    const draftsDir = path.join(envDir, "drafts");
                    const files = await fs.readdir(draftsDir);
                    envReport.drafts = {
                        total: files.filter((f) => f.endsWith(".draft.md")).length,
                    };
                } catch {
                    envReport.drafts = { total: 0 };
                }

                // List active extraction streams
                try {
                    const extractionsDir = path.join(envDir, "extractions");
                    const dirs = await fs.readdir(extractionsDir);
                    envReport.extractions = {
                        active_streams: dirs.filter(
                            (d) => !d.startsWith(".") && d !== "rejected"
                        ),
                    };
                } catch {
                    envReport.extractions = { active_streams: [] };
                }

                // Coverage scan
                envReport.coverage = await this._coverageScan(envDir);

                environments[envName] = envReport;
            }

            return {
                version: {
                    current: currentVersion,
                    ...upgradeInfo,
                },
                container,
                environments,
            };
        } catch (e) {
            return {
                error: e.message,
            };
        }
    }

    async scanShelf({ mode }, envDir, envName) {
        if (!["coverage", "consistency", "full"].includes(mode)) {
            return {
                error: 'Invalid mode. Use: "coverage", "consistency", or "full"',
            };
        }

        // Reset batch promotion counter — scan_shelf is the checkpoint
        this._promotionCounts.set(envName, 0);

        try {
            const shelfMdPath = path.join(envDir, "SHELF.md");

            if (!existsSync(shelfMdPath)) {
                return {
                    error: "SHELF.md not found in current environment",
                };
            }

            const result = {
                mode,
                environment: envName,
            };

            if (mode === "coverage" || mode === "full") {
                const coverage = await this._coverageScan(envDir);
                result.summary = {
                    total_files: coverage.total_files,
                    total_entries: coverage.total_entries,
                    orphaned: coverage.orphaned_files.length,
                    phantoms: coverage.phantom_entries.length,
                    clean: coverage.clean,
                };
                result.orphaned = coverage.orphaned_files.map((f) => ({
                    file: f,
                    issue: "File exists on Shelf but has no SHELF.md entry",
                }));
                result.phantoms = coverage.phantom_entries.map((e) => ({
                    entry: e,
                    issue: "SHELF.md entry references non-existent file",
                }));
            }

            if (mode === "consistency" || mode === "full") {
                const consistency = await this._consistencyScan(envDir);
                result.summary = result.summary || {};
                result.summary.checked = consistency.checked;
                result.summary.mismatched = consistency.mismatched.length;
                result.summary.no_meta = consistency.no_meta.length;
                result.summary.clean =
                    consistency.mismatched.length === 0 &&
                    consistency.no_meta.length === 0;
                result.mismatched = consistency.mismatched;
                result.no_meta = consistency.no_meta;
            }

            return result;
        } catch (e) {
            return {
                error: e.message,
            };
        }
    }

    async _coverageScan(olliDir) {
        try {
            // Get all .context.md files in shelf/
            const shelfDir = path.join(olliDir, "shelf");
            let files = [];
            if (existsSync(shelfDir)) {
                const dirEntries = await fs.readdir(shelfDir);
                files = dirEntries.filter((f) => f.endsWith(".context.md"));
            }

            // Get all File entries from SHELF.md (filename-only)
            const shelfMdPath = path.join(olliDir, "SHELF.md");
            let entries = [];
            if (existsSync(shelfMdPath)) {
                const shelfContent = await fs.readFile(
                    shelfMdPath,
                    "utf-8"
                );
                entries = parseManifestEntries(shelfContent).map(
                    (e) => e.file
                );
            }

            // Diff
            const orphaned = files.filter((f) => !entries.includes(f));
            const phantoms = entries.filter((e) => !files.includes(e));

            return {
                total_files: files.length,
                total_entries: entries.length,
                orphaned_files: orphaned,
                phantom_entries: phantoms,
                clean: orphaned.length === 0 && phantoms.length === 0,
            };
        } catch (e) {
            return {
                error: e.message,
            };
        }
    }

    async _consistencyScan(olliDir) {
        const shelfMdPath = path.join(olliDir, "SHELF.md");
        const shelfContent = await fs.readFile(shelfMdPath, "utf-8");
        const shelfEntries = parseManifestEntries(shelfContent);
        const shelfDir = path.join(olliDir, "shelf");

        const result = {
            checked: 0,
            mismatched: [],
            no_meta: [],
        };

        for (const shelfEntry of shelfEntries) {
            // File field is filename-only — look in shelf/
            const filePath = path.join(shelfDir, shelfEntry.file);
            if (!existsSync(filePath)) {
                continue; // Skip missing files
            }

            result.checked++;

            // Read file and parse capsule-meta
            const content = await fs.readFile(filePath, "utf-8");
            const metaMatch = content.match(/<!-- capsule-meta\n([\s\S]*?)-->/);

            if (!metaMatch) {
                result.no_meta.push(shelfEntry.file);
                continue;
            }

            // Parse meta fields
            const metaText = metaMatch[1];
            const getMeta = (field) => {
                const re = new RegExp(`^- ${field}: (.+)$`, "m");
                const m = metaText.match(re);
                return m ? m[1].trim() : "";
            };

            const capsuleMeta = {
                feature: getMeta("Feature"),
                file: getMeta("File"),
                scope: getMeta("Scope"),
                depends_on: getMeta("Depends on"),
                source_stream: getMeta("Source Stream"),
            };

            // Compare
            const diffFields = [];
            if (capsuleMeta.feature !== shelfEntry.feature) {
                diffFields.push("feature");
            }
            if (capsuleMeta.scope !== shelfEntry.scope) {
                diffFields.push("scope");
            }
            if (capsuleMeta.depends_on !== shelfEntry.dependsOn) {
                diffFields.push("depends_on");
            }

            if (diffFields.length > 0) {
                result.mismatched.push({
                    file: shelfEntry.file,
                    shelf_entry: {
                        feature: shelfEntry.feature,
                        scope: shelfEntry.scope,
                        depends_on: shelfEntry.dependsOn,
                    },
                    capsule_meta: capsuleMeta,
                    differing_fields: diffFields,
                });
            }
        }

        return result;
    }

    // ─── Manifest Tools ─────────────────────────────────────────────

    /**
     * Resolve manifest file path from name
     */
    resolveManifestPath(manifest, envDir) {
        switch (manifest) {
            case "shelf":
                return path.join(envDir, "SHELF.md");
            case "rack":
                return path.join(envDir, "RACK.md");
            case "crate":
                return path.join(envDir, "CRATE.md");
            default:
                throw new Error(
                    `Invalid manifest: "${manifest}". Use "shelf", "rack", or "crate".`,
                );
        }
    }

    /**
     * Read and parse a manifest file
     */
    async readManifest(manifest, envDir, envName) {
        const manifestPath = this.resolveManifestPath(manifest, envDir);

        if (!existsSync(manifestPath)) {
            throw new Error(
                `${manifest.toUpperCase()}.md not found in ${envName} environment`,
            );
        }

        const content = await fs.readFile(manifestPath, "utf-8");
        const entries = parseManifestEntries(content);

        return {
            manifest,
            environment: envName,
            path: manifestPath,
            entry_count: entries.length,
            entries: entries.map((e) => ({
                feature: e.feature,
                file: e.file,
                categories: e.categories || null,
                roles: e.roles || null,
                scope: e.scope || null,
                depends_on: e.dependsOn || null,
                updated: e.updated || null,
                crated: e.crated || null,
                source_stream: e.sourceStream || null,
            })),
        };
    }

    /**
     * Edit a manifest: add, update, or remove entries
     */
    async editManifest({
        manifest, action, lookup,
        feature, file, categories, roles, scope,
        depends_on, updated, source_stream, crated,
    }, envDir, envName) {
        const manifestPath = this.resolveManifestPath(manifest, envDir);

        if (!existsSync(manifestPath)) {
            throw new Error(
                `${manifest.toUpperCase()}.md not found in ${envName} environment`,
            );
        }

        const content = await fs.readFile(manifestPath, "utf-8");
        const entries = parseManifestEntries(content);

        switch (action) {
            case "add": {
                if (!feature) {
                    throw new Error("feature is required for add action");
                }
                if (!file) {
                    throw new Error("file is required for add action");
                }

                // Collision check
                const existing = entries.find((e) => e.feature === feature);
                if (existing) {
                    return {
                        status: "collision",
                        existing_entry: {
                            feature: existing.feature,
                            file: existing.file,
                        },
                        message: `An entry with Feature "${feature}" already exists.`,
                    };
                }

                const newEntry = formatManifestEntry({
                    feature,
                    file,
                    categories,
                    roles,
                    scope: scope || "",
                    dependsOn: depends_on,
                    updated,
                    sourceStream: source_stream,
                    crated,
                });

                const newContent = content.trimEnd() + "\n\n" + newEntry + "\n";
                await fs.writeFile(manifestPath, newContent, "utf-8");

                return {
                    status: "success",
                    action: "add",
                    manifest,
                    entry: newEntry,
                };
            }

            case "update": {
                if (!lookup) {
                    throw new Error("lookup is required for update action");
                }

                const idx = entries.findIndex(
                    (e) => e.feature === lookup || e.file === lookup,
                );
                if (idx === -1) {
                    return {
                        status: "error",
                        message: `No entry found matching '${lookup}'.`,
                    };
                }

                const existing = entries[idx];
                const before = existing.text;

                // Merge: only overwrite explicitly passed fields
                const merged = {
                    feature: feature !== undefined ? feature : existing.feature,
                    file: file !== undefined ? file : existing.file,
                    categories: categories !== undefined ? categories : existing.categories,
                    roles: roles !== undefined ? roles : existing.roles,
                    scope: scope !== undefined ? scope : existing.scope,
                    dependsOn: depends_on !== undefined ? depends_on : existing.dependsOn,
                    updated: updated !== undefined ? updated : existing.updated,
                    sourceStream: source_stream !== undefined ? source_stream : existing.sourceStream,
                    crated: crated !== undefined ? crated : existing.crated,
                };

                const newEntryText = formatManifestEntry(merged);
                const newContent =
                    content.slice(0, existing.start) +
                    newEntryText +
                    content.slice(existing.end);
                await fs.writeFile(manifestPath, newContent, "utf-8");

                return {
                    status: "success",
                    action: "update",
                    manifest,
                    before,
                    after: newEntryText,
                };
            }

            case "remove": {
                if (!lookup) {
                    throw new Error("lookup is required for remove action");
                }

                const entry = entries.find(
                    (e) => e.feature === lookup || e.file === lookup,
                );
                if (!entry) {
                    return {
                        status: "error",
                        message: `No entry found matching '${lookup}'.`,
                    };
                }

                // Remove entry and surrounding whitespace cleanly
                let removeStart = entry.start;
                let removeEnd = entry.end;

                if (
                    removeStart >= 2 &&
                    content.slice(removeStart - 2, removeStart) === "\n\n"
                ) {
                    removeStart -= 2;
                } else if (
                    removeEnd + 2 <= content.length &&
                    content.slice(removeEnd, removeEnd + 2) === "\n\n"
                ) {
                    removeEnd += 2;
                }

                const newContent =
                    content.slice(0, removeStart) + content.slice(removeEnd);
                await fs.writeFile(manifestPath, newContent, "utf-8");

                return {
                    status: "success",
                    action: "remove",
                    manifest,
                    removed_entry: entry.text,
                };
            }

            default:
                throw new Error(
                    `Invalid action: "${action}". Use "add", "update", or "remove".`,
                );
        }
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Olliver MCP server running (container mode)");
    }
}

/**
 * Parse capsule metadata from markdown content
 * Extracts Role and Purpose from structured headers
 */
function parseCapsuleMetadata(content) {
    const metadata = {
        role: null,
        purpose: null,
    };

    const roleMatch = content.match(/##\s+Role\s*\n\s*(.+)/);
    if (roleMatch) {
        metadata.role = roleMatch[1].trim();
    }

    const purposeMatch = content.match(/##\s+Purpose\s*\n\s*(.+)/);
    if (purposeMatch) {
        metadata.purpose = purposeMatch[1].trim();
    }

    return metadata;
}

/**
 * Parse all manifest entries from content.
 * Handles both formats:
 *   Old: `- Field: value` (all lines dash-prefixed)
 *   New: `- Feature: name` then `  Field: value` (indented continuation)
 * Returns array of { start, end, text, feature, file, categories, roles, scope, dependsOn, updated, sourceStream, crated }
 */
function parseManifestEntries(content) {
    const entries = [];
    const featureRegex = /^- Feature:\s*(.+)$/gm;
    const positions = [];

    let match;
    while ((match = featureRegex.exec(content)) !== null) {
        positions.push(match.index);
    }

    for (let i = 0; i < positions.length; i++) {
        const start = positions[i];
        const rawEnd = i + 1 < positions.length ? positions[i + 1] : content.length;
        const rawText = content.slice(start, rawEnd);
        const text = rawText.trimEnd();

        const entry = { start, end: start + text.length };

        const fieldLine = (field) => {
            // Match both `- Field: value` and `  Field: value`
            const re = new RegExp(`^(?:- |  )${field}:\\s*(.+)$`, "m");
            const m = text.match(re);
            return m ? m[1].trim() : "";
        };

        entry.feature = fieldLine("Feature");
        entry.file = fieldLine("File");
        entry.categories = fieldLine("Categories");
        entry.roles = fieldLine("Roles");
        entry.scope = fieldLine("Scope");
        entry.dependsOn = fieldLine("Depends on");
        entry.updated = fieldLine("Updated");
        entry.sourceStream = fieldLine("Source Stream");
        entry.crated = fieldLine("Crated");
        entry.text = text;

        entries.push(entry);
    }

    return entries;
}

/**
 * Format a manifest entry into markdown lines.
 * Uses canonical format: dash on Feature, indented continuation on all other fields.
 * Conditionally includes Updated and Crated fields when present.
 */
function formatManifestEntry({ feature, file, categories, roles, scope, dependsOn, updated, sourceStream, crated }) {
    const lines = [
        `- Feature: ${feature}`,
        `  File: ${file}`,
        `  Categories: ${categories || "uncategorized"}`,
        `  Roles: ${roles || "general"}`,
        `  Scope: ${scope}`,
        `  Depends on: ${dependsOn || "None noted"}`,
    ];
    if (updated) {
        lines.push(`  Updated: ${updated}`);
    }
    if (crated) {
        lines.push(`  Crated: ${crated}`);
    }
    lines.push(`  Source Stream: ${sourceStream}`);
    return lines.join("\n");
}

// Start server
const server = new OlliverServer();
server.run().catch(console.error);
