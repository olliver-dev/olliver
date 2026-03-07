/**
 * Shared Shelf Helpers
 *
 * Common parsing and path utilities used across CLI commands.
 */

import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

/**
 * Parse RACK.md to discover mounted capsules and stale entries.
 * RACK.md uses entry-based format (same as SHELF.md).
 * Returns { mounted: [{path, valid}], stale: number }
 */
export async function parseRack(envDir) {
    const rackPath = path.join(envDir, "RACK.md");
    const shelfDir = path.join(envDir, "shelf");
    const result = { mounted: [], stale: 0 };

    if (!existsSync(rackPath)) return result;

    try {
        const content = await fs.readFile(rackPath, "utf-8");

        // Parse entries using the Feature/File format
        const featureRegex = /^- Feature:\s*(.+)$/gm;
        let match;
        while ((match = featureRegex.exec(content)) !== null) {
            const start = match.index;
            const text = content.slice(start, content.indexOf("\n\n", start) > -1 ? content.indexOf("\n\n", start) : content.length).trimEnd();
            const fileMatch = text.match(/^- File:\s*(.+)$/m);
            if (fileMatch) {
                const file = fileMatch[1].trim();
                const fullPath = path.join(shelfDir, file);
                const valid = existsSync(fullPath);
                result.mounted.push({ path: file, valid });
                if (!valid) result.stale++;
            }
        }
    } catch {
        /* ignore */
    }

    return result;
}
