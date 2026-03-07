/**
 * CLI Output Helpers
 *
 * Consistent, polished terminal output using chalk.
 * No stack traces, no raw errors — ever.
 */

import chalk from "chalk";

// ─── Quiet Mode ────────────────────────────────────────────────

let _quiet = false;

export function setQuiet(flag) {
    _quiet = flag;
}

// ─── Status Indicators ──────────────────────────────────────────

export const ok = (msg) => console.log(`  ${chalk.green("✔")} ${msg}`);
export const info = (msg) => { if (!_quiet) console.log(`  ${chalk.blue("ℹ")} ${msg}`); };
export const warn = (msg) => console.log(`  ${chalk.yellow("⚠")} ${msg}`);
export const skip = (msg) => { if (!_quiet) console.log(`  ${chalk.dim("–")} ${msg}`); };

// ─── Error Display ──────────────────────────────────────────────

/**
 * Display a formatted error with explanation and fix suggestions
 */
export function showError(summary, details, fix) {
    console.error();
    console.error(`${chalk.red("✖")} ${summary}`);

    if (details) {
        console.error();
        console.error(`  ${details}`);
    }

    if (fix) {
        console.error();
        console.error(`  ${fix}`);
    }

    console.error();
}

/**
 * Handle an error object with structured fields
 */
export function handleError(error) {
    if (error.code === "SHELF_NOT_FOUND") {
        showError(
            "No shelf configured",
            error.details,
            `Run ${chalk.cyan("olli install")} to set up your shelf.`,
        );
        process.exit(3);
    }

    if (error.code === "EACCES" || error.code === "EPERM") {
        showError(
            `Permission denied: ${error.path || ""}`,
            "Cannot write to the specified path.",
            "Check directory permissions and try again.",
        );
        process.exit(4);
    }

    // Generic fallback — still no stack trace
    showError(
        error.message || "An unexpected error occurred",
        error.details || null,
        error.fix || `Run ${chalk.cyan("olli -h")} for help.`,
    );
    process.exit(1);
}

// ─── Box Drawing ────────────────────────────────────────────────

/**
 * Draw a box around lines of text
 */
export function box(lines) {
    lines = lines.flatMap((l) => l.split("\n"));
    const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length));
    const width = maxLen + 4;
    const top = "┌" + "─".repeat(width) + "┐";
    const bottom = "└" + "─".repeat(width) + "┘";
    const empty = "│" + " ".repeat(width) + "│";

    console.log(top);
    console.log(empty);
    for (const line of lines) {
        const padding = width - stripAnsi(line).length - 4;
        console.log(`│  ${line}${" ".repeat(Math.max(0, padding))}  │`);
    }
    console.log(empty);
    console.log(bottom);
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str) {
    return str.replace(/\x1B\[[0-9;]*m/g, "");
}

// ─── Section Headers ────────────────────────────────────────────

export function header(text) {
    if (_quiet) return;
    console.log();
    console.log(chalk.yellow(text));
}

export function label(key, value) {
    console.log(`  ${chalk.dim(key.padEnd(14))}${value}`);
}

export function bullet(text) {
    console.log(`  • ${text}`);
}

export function numbered(index, text) {
    console.log(`  ${chalk.dim(`${index}.`)} ${text}`);
}

export function blank() {
    if (_quiet) return;
    console.log();
}
