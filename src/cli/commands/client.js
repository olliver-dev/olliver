/**
 * olli client
 *
 * Interactive menu for MCP client setup guides.
 * Client list is filesystem-driven from guides/clients/.
 */

import fs from "fs/promises";
import path from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import chalk from "chalk";
import { handleError, blank, info } from "../helpers/output.js";
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
const CLIENTS_DIR = path.join(__dirname, "..", "templates", "guides", "clients");

// Special case name mappings
const NAME_OVERRIDES = {
    vscode: "VS Code",
    chatgpt: "ChatGPT",
    jetbrains: "JetBrains",
};

/**
 * Derive a human-readable client name from a guide filename
 */
function clientNameFromFilename(filename) {
    const slug = filename
        .replace(/\.md$/, "")
        .replace(/-setup$/, "");

    if (NAME_OVERRIDES[slug]) {
        return NAME_OVERRIDES[slug];
    }

    return slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Discover client guides from the clients/ directory
 */
async function discoverClients() {
    const clients = [];

    try {
        const entries = await fs.readdir(CLIENTS_DIR);
        for (const entry of entries.sort()) {
            if (entry.endsWith(".md")) {
                clients.push({
                    file: entry,
                    name: clientNameFromFilename(entry),
                    path: path.join(CLIENTS_DIR, entry),
                });
            }
        }
    } catch {
        /* directory not found */
    }

    return clients;
}

/**
 * Render a guide file in the terminal
 */
async function renderGuide(guidePath) {
    const content = await fs.readFile(guidePath, "utf-8");
    blank();
    console.log(renderMarkdown(content.trim()));
}

async function waitForInput() {
    const answer = await prompt(chalk.dim("\nPress Enter to return to clients, or q to exit: "));
    return answer.toLowerCase() === "q" || answer.toLowerCase() === "quit";
}

/**
 * Run the interactive client menu (reusable from help command)
 */
export async function runClientMenu() {
    const clients = await discoverClients();

    if (clients.length === 0) {
        console.error(
            "No client guides found. Reinstall Olliver to restore guides.",
        );
        return;
    }

    let running = true;
    while (running) {
        blank();
        console.log(chalk.bold("MCP Server Configuration"));
        blank();
        for (let i = 0; i < clients.length; i++) {
            console.log(`  ${chalk.cyan(String(i + 1).padStart(2, " "))}. ${clients[i].name}`);
        }
        blank();

        const choice = await prompt(`Select a client (1-${clients.length}): `);
        const num = parseInt(choice, 10);

        if (num >= 1 && num <= clients.length) {
            await renderGuide(clients[num - 1].path);
            const quit = await waitForInput();
            if (quit) {
                running = false;
            }
        } else {
            console.log(chalk.yellow("Invalid selection."));
        }
    }
}

export default function clientCommand(program) {
    program
        .command("client")
        .description("Display MCP client setup guides")
        .action(async (_, cmd) => {
            try {
                const globalOpts = cmd.parent?.opts() || {};
                const noInteraction =
                    globalOpts.interaction === false ||
                    (!process.stdin.isTTY && !process.stdout.isTTY);

                // Non-interactive: list client names and exit
                if (noInteraction) {
                    const clients = await discoverClients();
                    for (const client of clients) {
                        console.log(client.name);
                    }
                    return;
                }

                await runClientMenu();
            } catch (error) {
                handleError(error);
            }
        });
}
