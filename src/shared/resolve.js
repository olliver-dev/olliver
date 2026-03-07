/**
 * Shared Shelf Resolution
 *
 * Resolution chain:
 * 1. Read ~/.olliver dotfile
 * 2. Fall back to .olli/ in current working directory
 *
 * Used by both CLI commands and MCP server.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { existsSync } from "fs";

const DOTFILE_NAME = ".olliver";
const OLLI_DIR = ".olli";

/**
 * Get the path to the ~/.olliver dotfile
 */
export function getDotfilePath() {
    return path.join(os.homedir(), DOTFILE_NAME);
}

/**
 * Read the shelf path from ~/.olliver
 * Returns null if dotfile doesn't exist or is invalid
 */
export async function readDotfile() {
    const dotfilePath = getDotfilePath();

    if (!existsSync(dotfilePath)) {
        return null;
    }

    try {
        const raw = await fs.readFile(dotfilePath, "utf-8");
        const parsed = JSON.parse(raw);

        if (parsed.shelf && typeof parsed.shelf === "string") {
            return parsed.shelf;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Read the full dotfile data from ~/.olliver
 * Returns the complete JSON object, or null if dotfile doesn't exist
 */
export async function readDotfileData() {
    const dotfilePath = getDotfilePath();

    if (!existsSync(dotfilePath)) {
        return null;
    }

    try {
        const raw = await fs.readFile(dotfilePath, "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Write the shelf path to ~/.olliver
 * Preserves existing fields and merges in optional extras (clients, installed_at)
 */
export async function writeDotfile(shelfPath, extras = {}) {
    const dotfilePath = getDotfilePath();
    const absolutePath = path.resolve(shelfPath);

    // Read existing data to preserve fields
    let existing = {};
    if (existsSync(dotfilePath)) {
        try {
            const raw = await fs.readFile(dotfilePath, "utf-8");
            existing = JSON.parse(raw);
        } catch {
            // Corrupted dotfile — start fresh
        }
    }

    const data = {
        ...existing,
        shelf: absolutePath,
        ...extras,
    };

    await fs.writeFile(
        dotfilePath,
        JSON.stringify(data, null, 2) + "\n",
        "utf-8",
    );

    return absolutePath;
}

/**
 * Resolve the shelf path
 *
 * 1. ~/.olliver dotfile
 * 2. .olli/ in current working directory
 * 3. null if nothing found
 */
export async function resolveShelf() {
    // 1. Try dotfile
    const dotfileShelf = await readDotfile();
    if (dotfileShelf && existsSync(dotfileShelf)) {
        return dotfileShelf;
    }

    // 2. Try .olli/ in current directory
    const localShelf = path.join(process.cwd(), OLLI_DIR);
    if (existsSync(localShelf)) {
        return localShelf;
    }

    return null;
}

/**
 * Resolve the shelf path or throw a descriptive error
 */
export async function resolveShelfOrFail() {
    const shelf = await resolveShelf();

    if (!shelf) {
        const dotfilePath = getDotfilePath();
        const error = new Error("No shelf configured");
        error.code = "SHELF_NOT_FOUND";
        error.details = `Checked ~/.olliver and .olli/ in current directory`;
        error.fix = "Run olli install to set up your shelf.";
        throw error;
    }

    return shelf;
}

/**
 * Check npm registry for latest Olliver version
 * Non-blocking with 3-second timeout
 * Returns { latest, upgrade_available } or throws on error
 */
export async function checkUpgrade(currentVersion) {
    const { default: https } = await import("node:https");
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("timeout"));
        }, 3000);

        try {
            const url = "https://registry.npmjs.org/olliver/latest";

            https.get(url, (res) => {
                clearTimeout(timeout);
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    try {
                        const pkg = JSON.parse(data);
                        const latest = pkg.version;
                        const upgrade_available =
                            latest !== currentVersion &&
                            latest.localeCompare(currentVersion, undefined, {
                                numeric: true,
                                sensitivity: "base",
                            }) > 0;
                        resolve({ latest, upgrade_available });
                    } catch (e) {
                        clearTimeout(timeout);
                        reject(e);
                    }
                });
            }).on("error", (e) => {
                clearTimeout(timeout);
                reject(e);
            });
        } catch (e) {
            clearTimeout(timeout);
            reject(e);
        }
    });
}
