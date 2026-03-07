/**
 * olli status
 *
 * Multi-environment dashboard showing shelf state, rack, crated,
 * receiving, and drafts for every discovered environment.
 */

import fs from "fs/promises";
import path from "path";
import { existsSync, readFileSync } from "fs";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { resolveShelfOrFail, checkUpgrade } from "../../shared/resolve.js";
import { label, blank, handleError } from "../helpers/output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(
    readFileSync(
        path.join(__dirname, "..", "..", "..", "package.json"),
        "utf-8",
    ),
);

export default function statusCommand(program) {
    program
        .command("status")
        .description("Show shelf state, rack, and pending drafts")
        .action(async () => {
            try {
                const containerDir = await resolveShelfOrFail();

                // Version with upgrade check
                let versionDisplay = `${chalk.cyan("v" + pkg.version)} (upgrade check unavailable)`;
                try {
                    const upgrade = await checkUpgrade(pkg.version);
                    if (upgrade.upgrade_available) {
                        versionDisplay = `${chalk.cyan("v" + pkg.version)} → ${chalk.cyan("v" + upgrade.latest)} available  (npm install -g olliver)`;
                    } else {
                        versionDisplay = `${chalk.cyan("v" + pkg.version)} (up to date)`;
                    }
                } catch {
                    // Upgrade check failed
                }

                blank();
                console.log(`Olliver ${versionDisplay}`);
                blank();
                label("Container:", containerDir);

                // Discover environments
                const envs = await discoverEnvironments(containerDir);

                if (envs.length === 0) {
                    blank();
                    console.log(`  No environments found. Run ${chalk.cyan("olli install")} to set one up.`);
                    blank();
                    return;
                }

                // Display each environment
                for (const env of envs) {
                    const envDir = path.join(containerDir, env.dir);
                    const capsules = await countFiles(path.join(envDir, "shelf"), ".context.md");
                    const rack = await countRackEntries(envDir);
                    const crated = await countFiles(path.join(envDir, "crated"), ".crate.md");
                    const receiving = await countAllFiles(path.join(envDir, "receiving"));
                    const drafts = await countFiles(path.join(envDir, "drafts"), ".draft.md");

                    blank();
                    console.log(chalk.green(env.name));
                    console.log(`  Capsules:   ${chalk.cyan(capsules)} on shelf`);
                    console.log(`  Rack:       ${chalk.cyan(rack)} mounted`);
                    console.log(`  Crated:     ${chalk.cyan(crated)}`);
                    console.log(`  Receiving:  ${chalk.cyan(receiving)} pending`);
                    console.log(`  Drafts:     ${chalk.cyan(drafts)}`);
                }

                blank();
            } catch (error) {
                handleError(error);
            }
        });
}

async function discoverEnvironments(containerDir) {
    const envs = [];
    try {
        const entries = await fs.readdir(containerDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith(".")) {
                const shelfMd = path.join(containerDir, entry.name, "SHELF.md");
                if (existsSync(shelfMd)) {
                    envs.push({
                        dir: entry.name,
                        name: entry.name.slice(1), // strip dot prefix
                    });
                }
            }
        }
    } catch {
        /* ignore */
    }
    envs.sort((a, b) => a.name.localeCompare(b.name));
    return envs;
}

async function countFiles(dir, extension) {
    if (!existsSync(dir)) return 0;
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.filter(
            (e) => e.isFile() && e.name.endsWith(extension),
        ).length;
    } catch {
        return 0;
    }
}

async function countAllFiles(dir) {
    if (!existsSync(dir)) return 0;
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries.filter((e) => e.isFile()).length;
    } catch {
        return 0;
    }
}

async function countRackEntries(envDir) {
    const rackPath = path.join(envDir, "RACK.md");
    if (!existsSync(rackPath)) return 0;
    try {
        const content = await fs.readFile(rackPath, "utf-8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        // Count lines that look like capsule paths (end in .context.md)
        return lines.filter((l) => l.trim().endsWith(".context.md")).length;
    } catch {
        return 0;
    }
}
