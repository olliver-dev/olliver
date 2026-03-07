/**
 * olli help
 *
 * Interactive topic menu for Olliver operational guides.
 */

import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { handleError, blank, box } from "../helpers/output.js";
import renderMarkdown from "../helpers/render-markdown.js";

function prompt(question) {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GUIDES_DIR = path.join(__dirname, "..", "templates", "guides");

// Operational guides in GUIDES.md rendering order
const GUIDE_ORDER = [
    "what-is-olliver.md",
    "shelf-lifecycle.md",
    "environment-structure.md",
    "cli-commands.md",
    "mcp-tools.md",
    "working-with-capsules.md",
    "speaking-olli.md",
    "common-workflows.md",
    "getting-started.md",
];

// Words that should be fully uppercased in topic names
const UPPERCASE_WORDS = { mcp: "MCP", cli: "CLI", ai: "AI" };

/**
 * Derive a human-readable topic name from a guide filename
 */
function topicFromFilename(filename) {
    return filename
        .replace(/\.md$/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/\b\w+\b/g, (w) => UPPERCASE_WORDS[w.toLowerCase()] || w);
}

/**
 * Build ordered list of operational guides from the directory
 */
async function discoverGuides() {
    const guides = [];
    const seen = new Set();

    // First: add guides in defined order
    for (const file of GUIDE_ORDER) {
        const fullPath = path.join(GUIDES_DIR, file);
        if (existsSync(fullPath)) {
            guides.push({ file, topic: topicFromFilename(file), path: fullPath });
            seen.add(file);
        }
    }

    // Then: append any new guides not in the order list
    try {
        const entries = await fs.readdir(GUIDES_DIR);
        for (const entry of entries.sort()) {
            if (
                entry.endsWith(".md") &&
                entry !== "GUIDES.md" &&
                !seen.has(entry)
            ) {
                const fullPath = path.join(GUIDES_DIR, entry);
                const stat = await fs.stat(fullPath);
                if (stat.isFile()) {
                    guides.push({ file: entry, topic: topicFromFilename(entry), path: fullPath });
                }
            }
        }
    } catch {
        /* directory read failed — use ordered list only */
    }

    return guides;
}

/**
 * Render a guide file in the terminal
 */
async function renderGuide(guidePath) {
    const content = await fs.readFile(guidePath, "utf-8");
    blank();
    console.log(renderMarkdown(content.trim()));
}

/**
 * Render all operational guides concatenated
 */
async function renderAll(guides) {
    const sections = [];
    for (const guide of guides) {
        const content = await fs.readFile(guide.path, "utf-8");
        sections.push(content.trim());
    }
    const combined = sections.join("\n\n---\n\n");
    blank();
    console.log(renderMarkdown(combined));
}

async function waitForInput() {
    const answer = await prompt(chalk.dim("\nPress Enter to return to topics, or q to exit: "));
    return answer.toLowerCase() === "q" || answer.toLowerCase() === "quit";
}

export default function helpCommand(program) {
    program
        .command("help")
        .description("Display Olliver help and usage guide")
        .action(async (_, cmd) => {
            try {
                const globalOpts = cmd.parent?.opts() || {};
                const noInteraction =
                    globalOpts.interaction === false ||
                    (!process.stdin.isTTY && !process.stdout.isTTY);

                const guides = await discoverGuides();

                if (guides.length === 0) {
                    console.error(
                        "No guide files found. Reinstall Olliver to restore guides.",
                    );
                    process.exit(1);
                }

                // Non-interactive: render all and exit
                if (noInteraction) {
                    await renderAll(guides);
                    return;
                }

                // Interactive topic menu
                const clientIdx = guides.length + 1;
                let running = true;
                while (running) {
                    blank();
                    console.log(chalk.bold("Olliver Help"));
                    blank();
                    for (let i = 0; i < guides.length; i++) {
                        console.log(`  ${chalk.cyan(String(i + 1).padStart(2, " "))}. ${guides[i].topic}`);
                    }
                    console.log(`  ${chalk.cyan(String(clientIdx).padStart(2, " "))}. AI Client Configuration`);
                    console.log(`  ${chalk.cyan(" 0")}. Show All`);
                    blank();

                    const choice = await prompt(`Select a topic (0-${clientIdx}): `);

                    const num = parseInt(choice, 10);

                    if (num === 0) {
                        await renderAll(guides);
                        running = false;
                    } else if (num === clientIdx) {
                        const { runClientMenu } = await import("./client.js");
                        await runClientMenu();
                    } else if (num >= 1 && num <= guides.length) {
                        await renderGuide(guides[num - 1].path);
                        const quit = await waitForInput();
                        if (quit) {
                            running = false;
                        }
                    } else {
                        console.log(chalk.yellow("Invalid selection."));
                    }
                }
            } catch (error) {
                handleError(error);
            }
        });
}
