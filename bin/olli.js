#!/usr/bin/env node

/**
 * Olliver CLI — olli
 *
 * Durable context for AI collaboration.
 */

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import chalk from "chalk";
import installCommand from "../src/cli/commands/install.js";
import statusCommand from "../src/cli/commands/status.js";
import helpCommand from "../src/cli/commands/help.js";
import clientCommand from "../src/cli/commands/client.js";
import { setQuiet } from "../src/cli/helpers/output.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(
    readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program
    .name("olli")
    .description("Olliver — Durable context for AI collaboration")
    .version(pkg.version, "-v, --version", "Display this application version")
    .option("-q, --quiet", "Suppress non-essential output")
    .option("--no-ansi", "Disable colored output")
    .option("--no-interaction", "Do not ask interactive questions")
    .addHelpText("after", "\nFor the full usage guide, run: olli help");

// Apply global flags before any command runs
program.hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.ansi === false) {
        chalk.level = 0;
    }
    if (opts.quiet) {
        setQuiet(true);
    }
});

// Register commands
installCommand(program);
statusCommand(program);
helpCommand(program);
clientCommand(program);

// Handle unknown commands
program.on("command:*", ([cmd]) => {
    console.error();
    console.error(`  Unknown command: ${cmd}`);
    console.error();
    console.error(`  Run olli -h to see available commands.`);
    console.error();
    process.exit(2);
});

// Apply --no-ansi early for help output (preAction doesn't fire without a command)
if (process.argv.includes("--no-ansi")) {
    chalk.level = 0;
}

// Show help if no command given
if (process.argv.length <= 2) {
    program.help();
}

program.parse();
