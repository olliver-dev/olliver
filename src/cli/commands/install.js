/**
 * olli install
 *
 * Set up a new Olliver shelf.
 */

import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import chalk from "chalk";
import {
    getDotfilePath,
    readDotfile,
    writeDotfile,
} from "../../shared/resolve.js";
import {
    ok,
    info,
    skip,
    showError,
    handleError,
    box,
    blank,
} from "../helpers/output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _inquirer;
async function getInquirer() {
    if (!_inquirer) {
        const mod = await import("inquirer");
        _inquirer = mod.default;
    }
    return _inquirer;
}

/**
 * Convert a string to kebab-case for environment directory naming
 */
function toKebabCase(str) {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

export default function installCommand(program) {
    program
        .command("install")
        .description("Set up a new Olliver shelf")
        .option(
            "--shelf <path>",
            "Path for the shelf (default: current directory)",
        )
        .action(async (options) => {
            try {
                await runInstall(options, program.opts());
            } catch (error) {
                handleError(error);
            }
        });
}

async function runInstall(options, globalOpts) {
    let noInteraction = globalOpts.interaction === false;

    if (!process.stdin.isTTY && !process.stdout.isTTY && !noInteraction) {
        noInteraction = true;
        info("Non-interactive environment detected — running with defaults.");
        info("Use --no-interaction to suppress this message.");
    }

    // ─── Welcome ──────────────────────────────────────────────────
    blank();
    box([
        `${chalk.bold("Welcome to Olliver")}`,
        `${chalk.dim("Durable context for AI collaboration")}`,
    ]);
    blank();

    // ─── Step 1: Shelf Location ───────────────────────────────────
    let shelfBase;

    if (options.shelf) {
        shelfBase = path.resolve(options.shelf);
    } else if (noInteraction) {
        shelfBase = process.cwd();
    } else {
        const answers = await (await getInquirer()).prompt([
            {
                type: "input",
                name: "shelfPath",
                message: "Where should your shelf live?",
                default: ".",
                suffix: chalk.dim(
                    `\n  This will create .olli/ in the specified directory.\n  For a different location, use: olli install --shelf=/path/to/shelf\n`,
                ),
            },
        ]);
        shelfBase = path.resolve(answers.shelfPath);
    }

    // If the user passed a path ending in .olli, use it directly
    let containerDir = path.basename(shelfBase) === ".olli"
        ? shelfBase
        : path.join(shelfBase, ".olli");

    // Validate the base path exists and is writable
    const checkDir = existsSync(shelfBase)
        ? shelfBase
        : path.dirname(shelfBase);
    try {
        await fs.access(checkDir, fs.constants.W_OK);
    } catch {
        showError(
            `Cannot write to ${shelfBase}`,
            "The specified path is not writable.",
            `Check permissions or choose a different location with ${chalk.cyan("--shelf=/path/to/shelf")}`,
        );
        process.exit(4);
    }

    // ─── Step 2: Write Dotfile ────────────────────────────────────
    const dotfilePath = getDotfilePath();
    const existingDotfile = await readDotfile();

    if (existingDotfile && !noInteraction) {
        const { overwrite } = await (await getInquirer()).prompt([
            {
                type: "confirm",
                name: "overwrite",
                message: `~/.olliver already points to ${existingDotfile}. Update to ${containerDir}?`,
                default: true,
            },
        ]);
        if (!overwrite) {
            // Use the existing dotfile path instead of the local default
            containerDir = existingDotfile;
            info(`Using existing shelf at ${chalk.cyan(containerDir)}`);
        } else {
            await writeDotfile(containerDir, {
                installed_at: new Date().toISOString().slice(0, 10),
            });
            ok(`Shelf path saved to ${chalk.dim("~/.olliver")}`);
        }
    } else {
        await writeDotfile(containerDir, {
            installed_at: new Date().toISOString().slice(0, 10),
        });
        ok(`Shelf path saved to ${chalk.dim("~/.olliver")}`);
    }

    const isExistingContainer = existsSync(containerDir);

    if (isExistingContainer) {
        info(`Found existing .olli/ container at ${chalk.cyan(containerDir)}`);
    }

    // ─── Step 3: Scaffold Container ──────────────────────────────
    const { default: ora } = await import("ora");
    const spinner = ora("Setting up shelf...").start();

    try {
        if (!isExistingContainer) {
            await fs.mkdir(containerDir, { recursive: true });
            spinner.succeed("Created .olli/ container");
        } else {
            spinner.succeed("Container exists — checking structure...");
        }

        spinner.stop();
    } catch (error) {
        spinner.fail("Container setup failed");
        throw error;
    }

    // ─── Step 4: Determine Environment ───────────────────────────
    let existingEnvs = [];
    try {
        const entries = await fs.readdir(containerDir, { withFileTypes: true });
        existingEnvs = entries
            .filter((e) => e.isDirectory() && e.name.startsWith("."))
            .map((e) => e.name);
    } catch {
        /* ignore */
    }

    let envName;
    if (existingEnvs.length > 0) {
        info(`Found existing environment${existingEnvs.length > 1 ? "s" : ""}: ${existingEnvs.map((e) => chalk.cyan(e)).join(", ")}`);
        if (!noInteraction) {
            const choices = [
                ...existingEnvs.map((e) => ({ name: `Use existing: ${e}`, value: e })),
                { name: "Create a new environment", value: "__new__" },
            ];
            const { selected } = await (await getInquirer()).prompt([
                {
                    type: "list",
                    name: "selected",
                    message: "Which environment would you like to set up?",
                    choices,
                },
            ]);
            if (selected === "__new__") {
                envName = await promptProjectName(noInteraction);
            } else {
                envName = selected;
            }
        } else {
            envName = existingEnvs[0];
            info(`Using existing environment: ${envName}`);
        }
    } else {
        envName = await promptProjectName(noInteraction);
    }

    const envDir = path.join(containerDir, envName);
    const isExistingEnv = existsSync(envDir);

    // ─── Step 5: Scaffold Environment ────────────────────────────
    const spinner2 = ora(`Setting up environment ${envName}...`).start();

    try {
        if (!isExistingEnv) {
            await fs.mkdir(envDir, { recursive: true });
        }

        // Create SHELF.md (if not exists)
        const shelfMdDest = path.join(envDir, "SHELF.md");
        if (!existsSync(shelfMdDest)) {
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

- Feature: <Human-readable name>
- File: <capsule-slug>.context.md
- Categories: <comma-separated>
- Roles: <comma-separated>
- Scope: <1–2 lines>
- Depends on: <comma-separated list or "None noted">
- Updated: <YYYY-MM-DD>
- Source Stream: <stream identifier>
`;
            await fs.writeFile(shelfMdDest, shelfMdContent, "utf-8");
            ok("Created SHELF.md");
        } else {
            skip("SHELF.md exists");
        }

        // Create RACK.md (if not exists)
        const rackDest = path.join(envDir, "RACK.md");
        if (!existsSync(rackDest)) {
            const rackContent = `# Rack

Mounted capsules participating in current context.

## Environment
${envName}

## Mounted Capsules

(empty)

## Metadata
- Last Modified: ${new Date().toISOString()}
- Capsule Count: 0
`;
            await fs.writeFile(rackDest, rackContent, "utf-8");
            ok("Created RACK.md");
        } else {
            skip("RACK.md exists — preserving rack state");
        }

        // Create shelf/ directory
        const shelfSubDir = path.join(envDir, "shelf");
        if (!existsSync(shelfSubDir)) {
            await fs.mkdir(shelfSubDir, { recursive: true });
            ok("Created shelf/");
        }

        // Create drafts/ directory
        const draftsDir = path.join(envDir, "drafts");
        if (!existsSync(draftsDir)) {
            await fs.mkdir(draftsDir, { recursive: true });
            ok("Created drafts/");
        }

        // Create receiving/ directory
        const receivingDir = path.join(envDir, "receiving");
        if (!existsSync(receivingDir)) {
            await fs.mkdir(receivingDir, { recursive: true });
            ok("Created receiving/");
        }

        // Create extractions/ directory
        const extractionsDir = path.join(envDir, "extractions");
        if (!existsSync(extractionsDir)) {
            await fs.mkdir(extractionsDir, { recursive: true });
            ok("Created extractions/");
        }

        // Create crated/ directory + CRATE.md
        const cratedDir = path.join(envDir, "crated");
        if (!existsSync(cratedDir)) {
            await fs.mkdir(cratedDir, { recursive: true });
            ok("Created crated/");
        }

        const crateMdPath = path.join(envDir, "CRATE.md");
        if (!existsSync(crateMdPath)) {
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
            await fs.writeFile(crateMdPath, crateScaffold, "utf-8");
            ok("Created CRATE.md");
        }

        spinner2.succeed(`Environment ${chalk.cyan(envName)} ready`);
    } catch (error) {
        spinner2.fail("Scaffold failed");
        throw error;
    }

    // ─── Summary ─────────────────────────────────────────────────
    blank();
    box([
        `${chalk.green("✔")} ${chalk.bold("Olliver is ready")}`,
        "",
        `${chalk.dim("Shelf:")}  ${containerDir}`,
        "",
        `${chalk.dim("Next steps:")}`,
        `1. Run ${chalk.cyan("olli client")} to set up your`,
        `   AI client connection`,
        `2. Run ${chalk.cyan("olli status")} to verify`,
    ]);
    blank();
}

/**
 * Prompt user for a project name and return the environment directory name
 */
async function promptProjectName(noInteraction) {
    if (noInteraction) {
        return ".default";
    }

    const { projectName } = await (await getInquirer()).prompt([
        {
            type: "input",
            name: "projectName",
            message: "What is the name of this project?",
            suffix: chalk.dim(
                "\n  This will be used to create an environment directory inside .olli/\n",
            ),
            validate: (input) => {
                if (!input || input.trim().length === 0) {
                    return "Project name is required";
                }
                return true;
            },
        },
    ]);

    const kebab = toKebabCase(projectName.trim());
    if (!kebab) {
        return ".default";
    }
    return `.${kebab}`;
}
