/**
 * Atomic File Writes
 *
 * Write to a sibling temp file, flush it, then rename it over the target.
 * Readers see either the old content or the new — never a torn write —
 * and a crash mid-write leaves the original intact.
 */

import fs from "fs/promises";
import crypto from "crypto";

// Windows can refuse a rename for a moment while another handle (a
// concurrent reader, an antivirus scan) has the target open. Elsewhere
// these errors are real and surface immediately.
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = process.platform === "win32" ? 5 : 1;

/**
 * Atomically replace (or create) `filePath` with `data` as UTF-8.
 */
export async function writeFileAtomic(filePath, data) {
    const suffix = crypto.randomBytes(6).toString("hex");
    const tmpPath = `${filePath}.tmp-${process.pid}-${suffix}`;

    try {
        const handle = await fs.open(tmpPath, "wx");
        try {
            await handle.writeFile(data, "utf-8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await renameWithRetry(tmpPath, filePath);
    } catch (error) {
        await fs.unlink(tmpPath).catch(() => {});
        throw error;
    }
}

async function renameWithRetry(from, to) {
    for (let attempt = 1; ; attempt++) {
        try {
            await fs.rename(from, to);
            return;
        } catch (error) {
            if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(error.code)) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
        }
    }
}
